-- Migration de DADOS (sem mudança de schema), irreversível:
--   1. Unifica contas duplicadas: ariany_f -> arianyferreira e sylviofox -> sylvio (fica a conta do username final;
--      se só a outra existir, ela só troca de username).
--   2. Registra convites (Referral) com as contas já unificadas e deixa convidado e quem convidou amigos (seguimento
--      aceito nos dois sentidos), como o ReferralService.claim faz.
-- Segura em banco vazio: username que não existe é pulado. Rodar de novo não muda nada.
--
-- Tabelas com FK para "User" (86 colunas no schema.prisma, todas tratadas; a checagem antes de apagar a conta aborta a
-- migration inteira se sobrar alguma linha apontando para ela):
--   AlbumMember, AlbumPhoto, AvailabilitySlot, Block(2), Boost, CalendarConnection, CloakroomTicket, ConsentEvent,
--   ContentDwell, ConversationParticipant, ConversationReport(2), DatePoll, DatePollConfirmation, DatePollParticipant,
--   DatePollVote, EventAttendance, EventInvite(2), EventStory, EventStoryLike, EventStoryReport, EventStoryView,
--   ExternalIdentity, FeedComment, FeedCommentReaction, FeedPost, FeedReaction, FeedReport(2), FlashAsk(2), FlashHidden(2),
--   FlashInvite(2), FlashPosition, FlashSession, Follow(2), Group, GroupMember, GuestListEntry, Meeting, MeetingParticipant,
--   Message, MessageAudioPlay, MessageReaction, Notification, NotificationSetting, PasswordReset, PhoneCode, Post,
--   PostComment, PostCommentLike, PostHidden, PostLike, PostReport, PostTag, PostedEvent, PostedUserEvent, Profile,
--   ProfilePhoto, PushSubscription, Referral(2), StoryHidden(2), UserMfa, UserRegion, UserReport(2), UserSettings, Venue,
--   VenueCheckin, VenueClaim(2), VenueFollow, VenueManager, VenueOffer, VenueRating, VenueStory, VenueStoryMute,
--   VenueStoryPref, VenueStoryReport.
-- Ids de pessoa sem FK, também tratados: Conversation.directKey/requestToId, FlashInvite.destinationChosenBy,
--   VenueManager.invitedById, EventReminder.userId, *.resolvedBy, AdminAudit.adminId, AppSetting.updatedBy e a chave
--   referral-badge-hidden:<id>, UserReport/FeedReport.dedupeKey, Notification.payload.

-- Move as linhas de `dropped` para `keep` numa coluna. `uniq` lista os uniques da tabela além da coluna da pessoa (cada
-- item é uma lista de colunas separadas por vírgula): a linha de `dropped` que repetiria uma de `keep` é apagada antes.
CREATE FUNCTION pg_temp.askout_move(tbl text, col text, keep uuid, dropped uuid, uniq text[] DEFAULT '{}') RETURNS void AS $f$
DECLARE
  u text;
  cond text;
BEGIN
  FOREACH u IN ARRAY uniq LOOP
    -- '' = a coluna da pessoa é a chave inteira (uma linha por pessoa): a de `dropped` sai se `keep` já tem a sua.
    SELECT COALESCE(string_agg(format('o.%1$I = t.%1$I', trim(c)), ' AND '), 'true') INTO cond
      FROM unnest(string_to_array(u, ',')) AS c WHERE trim(c) <> '';
    EXECUTE format('DELETE FROM %1$I t WHERE t.%2$I = $2 AND EXISTS (SELECT 1 FROM %1$I o WHERE o.%2$I = $1 AND %3$s)', tbl, col, cond)
      USING keep, dropped;
  END LOOP;
  EXECUTE format('UPDATE %1$I SET %2$I = $1 WHERE %2$I = $2', tbl, col) USING keep, dropped;
END
$f$ LANGUAGE plpgsql;

-- Funde a conta `dropped` em `keep` e apaga `dropped`.
CREATE FUNCTION pg_temp.askout_merge(keep uuid, dropped uuid) RETURNS void AS $f$
DECLARE
  k uuid := keep;
  d uuid := dropped;
  ks text := keep::text;
  ds text := dropped::text;
  du "User"%ROWTYPE;
  r record;
  other text;
  new_key text;
  target uuid;
  leftover bigint;
BEGIN
  SELECT * INTO du FROM "User" WHERE id = d;

  ---------------------------------------------------------------- conta
  -- Celular é único: passa para a conta final só se ela não tem um.
  IF du.phone IS NOT NULL AND (SELECT phone FROM "User" WHERE id = k) IS NULL THEN
    UPDATE "User" SET phone = NULL, "phoneHash" = NULL, "phoneVerifiedAt" = NULL WHERE id = d;
    UPDATE "User" SET phone = du.phone, "phoneHash" = du."phoneHash", "phoneVerifiedAt" = du."phoneVerifiedAt" WHERE id = k;
  END IF;
  UPDATE "User" u SET
    -- A conta final fica com a data da conta mais antiga e com o papel mais alto (USER < VENUE_OWNER < ADMIN).
    "createdAt"       = LEAST(u."createdAt", du."createdAt"),
    role              = GREATEST(u.role, du.role),
    "birthDate"       = COALESCE(u."birthDate", du."birthDate"),
    "termsAcceptedAt" = COALESCE(u."termsAcceptedAt", du."termsAcceptedAt"),
    "termsVersion"    = COALESCE(u."termsVersion", du."termsVersion"),
    "onboardedAt"     = COALESCE(u."onboardedAt", du."onboardedAt"),
    tastes            = ARRAY(SELECT DISTINCT unnest(u.tastes || du.tastes)),
    "profilePending"  = u."profilePending" AND du."profilePending",
    -- Se só a conta apagada tinha senha, a senha dela passa a valer na conta final (com o e-mail da final).
    "passwordHash"    = CASE WHEN u.passwordless AND NOT du.passwordless THEN du."passwordHash" ELSE u."passwordHash" END,
    passwordless      = u.passwordless AND du.passwordless,
    "updatedAt"       = now()
  WHERE u.id = k;

  -- Perfil: vale o da conta final e completa só o que falta nela (bio, foto). A foto enviada pela apagada vem junto se a
  -- final não tem foto própria; o endereço /users/<id>/avatar passa a ser o da final.
  PERFORM pg_temp.askout_move('ProfilePhoto', 'userId', k, d, ARRAY['']);
  UPDATE "Profile" p SET
    bio         = COALESCE(p.bio, o.bio),
    "avatarUrl" = COALESCE(p."avatarUrl", replace(o."avatarUrl", ds, ks))
  FROM "Profile" o WHERE p."userId" = k AND o."userId" = d;
  DELETE FROM "ProfilePhoto" WHERE "userId" = d;
  DELETE FROM "Profile" WHERE "userId" = d;

  -- Um por pessoa: vale o da conta final; o da apagada só entra se a final não tem.
  PERFORM pg_temp.askout_move('UserSettings', 'userId', k, d, ARRAY['']);
  PERFORM pg_temp.askout_move('NotificationSetting', 'userId', k, d, ARRAY['']);
  PERFORM pg_temp.askout_move('UserMfa', 'userId', k, d, ARRAY['']);
  PERFORM pg_temp.askout_move('UserRegion', 'userId', k, d, ARRAY['']);
  PERFORM pg_temp.askout_move('VenueStoryPref', 'userId', k, d, ARRAY['']);
  DELETE FROM "PasswordReset" WHERE "userId" = d; -- códigos em andamento: descartáveis
  DELETE FROM "PhoneCode" WHERE "userId" = d;

  -- Login Google/Apple: a chave é (provider, subject), então os vínculos das duas contas passam todos para a final.
  UPDATE "ExternalIdentity" SET "userId" = k WHERE "userId" = d;

  ---------------------------------------------------------------- relações entre pessoas
  -- O que liga uma conta à outra vira "consigo mesma": sai.
  DELETE FROM "Follow" WHERE ("followerId" = k AND "followeeId" = d) OR ("followerId" = d AND "followeeId" = k);
  DELETE FROM "Block" WHERE ("blockerId" = k AND "blockedId" = d) OR ("blockerId" = d AND "blockedId" = k);
  DELETE FROM "FlashAsk" WHERE ("askerId" = k AND "targetId" = d) OR ("askerId" = d AND "targetId" = k);
  DELETE FROM "FlashHidden" WHERE ("ownerId" = k AND "otherId" = d) OR ("ownerId" = d AND "otherId" = k);
  DELETE FROM "StoryHidden" WHERE ("ownerId" = k AND "otherId" = d) OR ("ownerId" = d AND "otherId" = k);
  DELETE FROM "FlashInvite" WHERE ("fromUserId" = k AND "toUserId" = d) OR ("fromUserId" = d AND "toUserId" = k);
  DELETE FROM "Referral" WHERE ("inviteeId" = k AND "inviterId" = d) OR ("inviteeId" = d AND "inviterId" = k);

  -- Seguimento repetido: fica um só, aceito se algum dos dois estava aceito.
  UPDATE "Follow" f SET status = 'ACCEPTED', "createdAt" = LEAST(f."createdAt", o."createdAt")
    FROM "Follow" o WHERE f."followerId" = k AND o."followerId" = d AND o."followeeId" = f."followeeId" AND o.status = 'ACCEPTED';
  UPDATE "Follow" f SET status = 'ACCEPTED', "createdAt" = LEAST(f."createdAt", o."createdAt")
    FROM "Follow" o WHERE f."followeeId" = k AND o."followeeId" = d AND o."followerId" = f."followerId" AND o.status = 'ACCEPTED';
  PERFORM pg_temp.askout_move('Follow', 'followerId', k, d, ARRAY['followeeId']);
  PERFORM pg_temp.askout_move('Follow', 'followeeId', k, d, ARRAY['followerId']);
  PERFORM pg_temp.askout_move('Block', 'blockerId', k, d, ARRAY['blockedId']);
  PERFORM pg_temp.askout_move('Block', 'blockedId', k, d, ARRAY['blockerId']);
  PERFORM pg_temp.askout_move('FlashAsk', 'askerId', k, d, ARRAY['targetId']);
  PERFORM pg_temp.askout_move('FlashAsk', 'targetId', k, d, ARRAY['askerId']);
  PERFORM pg_temp.askout_move('FlashHidden', 'ownerId', k, d, ARRAY['otherId']);
  PERFORM pg_temp.askout_move('FlashHidden', 'otherId', k, d, ARRAY['ownerId']);
  PERFORM pg_temp.askout_move('StoryHidden', 'ownerId', k, d, ARRAY['otherId']);
  PERFORM pg_temp.askout_move('StoryHidden', 'otherId', k, d, ARRAY['ownerId']);
  PERFORM pg_temp.askout_move('FlashInvite', 'fromUserId', k, d);
  PERFORM pg_temp.askout_move('FlashInvite', 'toUserId', k, d);
  UPDATE "FlashInvite" SET "destinationChosenBy" = k WHERE "destinationChosenBy" = d;
  PERFORM pg_temp.askout_move('FlashPosition', 'userId', k, d, ARRAY['inviteId']);
  PERFORM pg_temp.askout_move('FlashSession', 'userId', k, d);

  -- Convites: quem a conta final recebeu vale; os que a conta apagada fez passam a contar para a final.
  PERFORM pg_temp.askout_move('Referral', 'inviteeId', k, d, ARRAY['']);
  UPDATE "Referral" SET "inviterId" = k WHERE "inviterId" = d;

  ---------------------------------------------------------------- conversas
  -- Conversa a dois só entre as duas contas: viraria conversa consigo mesma. Sai (com as mensagens).
  DELETE FROM "Conversation" c
   WHERE c.type = 'DIRECT'
     AND EXISTS (SELECT 1 FROM "ConversationParticipant" p WHERE p."conversationId" = c.id AND p."userId" = k)
     AND EXISTS (SELECT 1 FROM "ConversationParticipant" p WHERE p."conversationId" = c.id AND p."userId" = d)
     AND NOT EXISTS (SELECT 1 FROM "ConversationParticipant" p WHERE p."conversationId" = c.id AND p."userId" NOT IN (k, d));

  -- Conversas a dois da conta apagada: a chave muda para a da conta final; se a final já conversava com a mesma pessoa
  -- (ou com a mesma página de local), as duas viram uma só, com as mensagens juntas.
  FOR r IN
    SELECT c.* FROM "Conversation" c
     WHERE c.type = 'DIRECT' AND c."directKey" IS NOT NULL
       AND EXISTS (SELECT 1 FROM "ConversationParticipant" p WHERE p."conversationId" = c.id AND p."userId" = d)
  LOOP
    IF r."directKey" LIKE 'venue:%' THEN
      new_key := replace(r."directKey", ds, ks); -- venue:<local>:<cliente>; sem mudança se a apagada é quem atende
    ELSE
      other := CASE WHEN split_part(r."directKey", ':', 1) = ds THEN split_part(r."directKey", ':', 2) ELSE split_part(r."directKey", ':', 1) END;
      -- Mesma ordem do app (comparação de string do JS): COLLATE "C".
      new_key := CASE WHEN ks COLLATE "C" < other COLLATE "C" THEN ks || ':' || other ELSE other || ':' || ks END;
    END IF;
    SELECT id INTO target FROM "Conversation" WHERE "directKey" = new_key AND id <> r.id;
    IF target IS NULL THEN
      UPDATE "Conversation" SET "directKey" = new_key WHERE id = r.id;
    ELSE
      UPDATE "Message" SET "conversationId" = target WHERE "conversationId" = r.id;
      UPDATE "Meeting" SET "conversationId" = target WHERE "conversationId" = r.id;
      UPDATE "DatePoll" SET "conversationId" = target WHERE "conversationId" = r.id;
      DELETE FROM "ConversationReport" x WHERE x."conversationId" = r.id
        AND EXISTS (SELECT 1 FROM "ConversationReport" y WHERE y."conversationId" = target AND y."reporterId" IN (x."reporterId", CASE WHEN x."reporterId" = d THEN k END));
      UPDATE "ConversationReport" SET "conversationId" = target WHERE "conversationId" = r.id;
      -- Preferências de cada um na conversa que fica: lido até o mais recente, fixada se fixou em alguma,
      -- "limpar" só se limpou nas duas (senão as mensagens da outra sumiriam).
      UPDATE "ConversationParticipant" t SET
        "lastReadAt" = GREATEST(t."lastReadAt", s."lastReadAt"),
        "pinnedAt"   = COALESCE(t."pinnedAt", s."pinnedAt"),
        "clearedAt"  = CASE WHEN t."clearedAt" IS NULL OR s."clearedAt" IS NULL THEN NULL ELSE LEAST(t."clearedAt", s."clearedAt") END,
        muted        = t.muted AND s.muted,
        color        = COALESCE(t.color, s.color)
      FROM "ConversationParticipant" s
      WHERE t."conversationId" = target AND s."conversationId" = r.id
        AND (t."userId" = s."userId" OR (s."userId" = d AND t."userId" = k));
      -- Pedido de mensagem: se alguma das duas já era conversa normal (ou aceita), a que fica também é.
      UPDATE "Conversation" t SET
        "createdAt"         = LEAST(t."createdAt", r."createdAt"),
        "requestToId"       = CASE WHEN t."requestToId" IS NULL OR r."requestToId" IS NULL THEN NULL ELSE t."requestToId" END,
        "requestDeclinedAt" = CASE WHEN t."requestToId" IS NULL OR r."requestToId" IS NULL THEN NULL ELSE t."requestDeclinedAt" END,
        "acceptedAt"        = COALESCE(t."acceptedAt", r."acceptedAt")
      WHERE t.id = target;
      UPDATE "Notification" SET payload = replace(payload::text, r.id::text, target::text)::jsonb WHERE payload::text LIKE '%' || r.id::text || '%';
      DELETE FROM "Conversation" WHERE id = r.id;
    END IF;
  END LOOP;
  UPDATE "Conversation" SET "requestToId" = k WHERE "requestToId" = d;
  -- Grupos em que as duas estavam: fica uma participação só (a da conta final).
  PERFORM pg_temp.askout_move('ConversationParticipant', 'userId', k, d, ARRAY['conversationId']);
  DELETE FROM "ConversationReport" x WHERE x."reporterId" = d
    AND EXISTS (SELECT 1 FROM "ConversationReport" y WHERE y."reporterId" = k AND y."conversationId" = x."conversationId");
  UPDATE "ConversationReport" SET "reporterId" = k WHERE "reporterId" = d;
  UPDATE "ConversationReport" SET "reportedUserId" = k WHERE "reportedUserId" = d;
  DELETE FROM "ConversationReport" WHERE "reporterId" = k AND "reportedUserId" = k;
  UPDATE "Message" SET "senderId" = k WHERE "senderId" = d;
  PERFORM pg_temp.askout_move('MessageReaction', 'userId', k, d, ARRAY['messageId']);
  PERFORM pg_temp.askout_move('MessageAudioPlay', 'userId', k, d, ARRAY['messageId']);

  ---------------------------------------------------------------- grupos e encontros
  -- Membro repetido: fica o papel mais alto (enum OWNER < ADMIN < MEMBER).
  UPDATE "GroupMember" t SET role = LEAST(t.role, s.role), "joinedAt" = LEAST(t."joinedAt", s."joinedAt")
    FROM "GroupMember" s WHERE t."userId" = k AND s."userId" = d AND s."groupId" = t."groupId";
  PERFORM pg_temp.askout_move('GroupMember', 'userId', k, d, ARRAY['groupId']);
  UPDATE "Group" SET "ownerId" = k WHERE "ownerId" = d;
  UPDATE "Meeting" SET "organizerId" = k WHERE "organizerId" = d;
  PERFORM pg_temp.askout_move('MeetingParticipant', 'userId', k, d, ARRAY['meetingId']);
  UPDATE "DatePoll" SET "organizerId" = k WHERE "organizerId" = d;
  PERFORM pg_temp.askout_move('DatePollParticipant', 'userId', k, d, ARRAY['pollId']);
  PERFORM pg_temp.askout_move('DatePollVote', 'userId', k, d, ARRAY['pollId,candidateDate']);
  PERFORM pg_temp.askout_move('DatePollConfirmation', 'userId', k, d, ARRAY['proposalId']);
  PERFORM pg_temp.askout_move('AvailabilitySlot', 'userId', k, d);
  PERFORM pg_temp.askout_move('CalendarConnection', 'userId', k, d);

  ---------------------------------------------------------------- posts, eventos, stories
  UPDATE "Post" SET "authorId" = k WHERE "authorId" = d;
  PERFORM pg_temp.askout_move('PostComment', 'authorId', k, d);
  PERFORM pg_temp.askout_move('PostCommentLike', 'userId', k, d, ARRAY['commentId']);
  PERFORM pg_temp.askout_move('PostLike', 'userId', k, d, ARRAY['postId']);
  PERFORM pg_temp.askout_move('PostHidden', 'userId', k, d, ARRAY['postId']);
  PERFORM pg_temp.askout_move('PostTag', 'userId', k, d, ARRAY['postId']);
  PERFORM pg_temp.askout_move('PostReport', 'reporterId', k, d, ARRAY['postId']);
  PERFORM pg_temp.askout_move('PostedEvent', 'userId', k, d, ARRAY['eventId']);
  PERFORM pg_temp.askout_move('PostedUserEvent', 'userId', k, d, ARRAY['postId']);
  PERFORM pg_temp.askout_move('EventInvite', 'userId', k, d, ARRAY['postId']);
  UPDATE "EventInvite" SET "invitedById" = k WHERE "invitedById" = d;
  UPDATE "EventInvite" SET "invitedById" = NULL WHERE "invitedById" = k AND "userId" = k;
  -- "Eu vou" repetido: fica um, no perfil se estava no perfil em algum.
  UPDATE "EventAttendance" t SET "onProfile" = t."onProfile" OR s."onProfile", "createdAt" = LEAST(t."createdAt", s."createdAt")
    FROM "EventAttendance" s WHERE t."userId" = k AND s."userId" = d
     AND (s."placeEventId" = t."placeEventId" OR s."postId" = t."postId");
  PERFORM pg_temp.askout_move('EventAttendance', 'userId', k, d, ARRAY['placeEventId', 'postId']);
  PERFORM pg_temp.askout_move('EventReminder', 'userId', k, d, ARRAY['source,eventId']);
  PERFORM pg_temp.askout_move('EventStory', 'userId', k, d);
  PERFORM pg_temp.askout_move('EventStoryLike', 'userId', k, d, ARRAY['storyId']);
  PERFORM pg_temp.askout_move('EventStoryView', 'userId', k, d, ARRAY['storyId']);
  PERFORM pg_temp.askout_move('EventStoryReport', 'reporterId', k, d, ARRAY['storyId']);
  PERFORM pg_temp.askout_move('FeedPost', 'authorId', k, d);
  PERFORM pg_temp.askout_move('FeedComment', 'authorId', k, d);
  PERFORM pg_temp.askout_move('FeedReaction', 'userId', k, d, ARRAY['postId']);
  PERFORM pg_temp.askout_move('FeedCommentReaction', 'userId', k, d, ARRAY['commentId']);
  PERFORM pg_temp.askout_move('AlbumMember', 'userId', k, d, ARRAY['albumId']);
  PERFORM pg_temp.askout_move('AlbumPhoto', 'authorId', k, d);
  PERFORM pg_temp.askout_move('GuestListEntry', 'userId', k, d, ARRAY['eventId']);
  PERFORM pg_temp.askout_move('CloakroomTicket', 'userId', k, d);

  ---------------------------------------------------------------- denúncias (a chave anti-repetição leva o id da pessoa)
  UPDATE "UserReport" x SET "dedupeKey" = replace(x."dedupeKey", ds, ks), "reporterId" = CASE WHEN x."reporterId" = d THEN k ELSE x."reporterId" END,
    "reportedUserId" = CASE WHEN x."reportedUserId" = d THEN k ELSE x."reportedUserId" END
   WHERE (x."reporterId" = d OR x."reportedUserId" = d)
     AND NOT EXISTS (SELECT 1 FROM "UserReport" y WHERE y."dedupeKey" = replace(x."dedupeKey", ds, ks) AND y.id <> x.id);
  DELETE FROM "UserReport" WHERE "reporterId" = d OR "reportedUserId" = d; -- as que repetiriam uma da conta final
  DELETE FROM "UserReport" WHERE "reporterId" = k AND "reportedUserId" = k;
  UPDATE "FeedReport" x SET "dedupeKey" = replace(x."dedupeKey", ds, ks), "reporterId" = CASE WHEN x."reporterId" = d THEN k ELSE x."reporterId" END,
    "reportedUserId" = CASE WHEN x."reportedUserId" = d THEN k ELSE x."reportedUserId" END
   WHERE (x."reporterId" = d OR x."reportedUserId" = d)
     AND NOT EXISTS (SELECT 1 FROM "FeedReport" y WHERE y."dedupeKey" = replace(x."dedupeKey", ds, ks) AND y.id <> x.id);
  DELETE FROM "FeedReport" WHERE "reporterId" = d OR "reportedUserId" = d;
  DELETE FROM "FeedReport" WHERE "reporterId" = k AND "reportedUserId" = k;
  UPDATE "ConversationReport" SET "resolvedBy" = k WHERE "resolvedBy" = d;
  UPDATE "UserReport" SET "resolvedBy" = k WHERE "resolvedBy" = d;
  UPDATE "PostReport" SET "resolvedBy" = k WHERE "resolvedBy" = d;
  UPDATE "EventStoryReport" SET "resolvedBy" = k WHERE "resolvedBy" = d;
  UPDATE "FeedReport" SET "resolvedBy" = k WHERE "resolvedBy" = d;
  UPDATE "VenueStoryReport" SET "resolvedBy" = k WHERE "resolvedBy" = d;

  ---------------------------------------------------------------- locais
  UPDATE "Venue" SET "ownerId" = k WHERE "ownerId" = d;
  UPDATE "VenueFollow" t SET notify = t.notify OR s.notify FROM "VenueFollow" s WHERE t."userId" = k AND s."userId" = d AND s."venueId" = t."venueId";
  PERFORM pg_temp.askout_move('VenueFollow', 'userId', k, d, ARRAY['venueId']);
  PERFORM pg_temp.askout_move('VenueManager', 'userId', k, d, ARRAY['venueId']);
  UPDATE "VenueManager" SET "invitedById" = k WHERE "invitedById" = d;
  DELETE FROM "VenueManager" m USING "Venue" v WHERE m."venueId" = v.id AND m."userId" = k AND v."ownerId" = k; -- dona não é gerente do próprio local
  PERFORM pg_temp.askout_move('VenueRating', 'userId', k, d, ARRAY['venueId']);
  PERFORM pg_temp.askout_move('VenueCheckin', 'userId', k, d);
  PERFORM pg_temp.askout_move('VenueClaim', 'userId', k, d);
  UPDATE "VenueClaim" SET "reviewedBy" = k WHERE "reviewedBy" = d;
  PERFORM pg_temp.askout_move('VenueOffer', 'ownerId', k, d);
  PERFORM pg_temp.askout_move('VenueStory', 'authorId', k, d);
  PERFORM pg_temp.askout_move('VenueStoryReport', 'reporterId', k, d, ARRAY['storyId']);
  PERFORM pg_temp.askout_move('VenueStoryMute', 'userId', k, d, ARRAY['venueId']);
  PERFORM pg_temp.askout_move('Boost', 'ownerId', k, d);

  ---------------------------------------------------------------- avisos, push, LGPD, gestão
  UPDATE "Notification" SET "userId" = k WHERE "userId" = d;
  UPDATE "Notification" SET payload = replace(payload::text, ds, ks)::jsonb WHERE payload::text LIKE '%' || ds || '%';
  UPDATE "PushSubscription" SET "userId" = k WHERE "userId" = d;
  UPDATE "ConsentEvent" SET "userId" = k WHERE "userId" = d;
  UPDATE "ContentDwell" SET "userId" = k WHERE "userId" = d;
  UPDATE "AdminAudit" SET "adminId" = k WHERE "adminId" = d;
  UPDATE "AppSetting" SET "updatedBy" = k WHERE "updatedBy" = d;
  IF EXISTS (SELECT 1 FROM "AppSetting" WHERE key = 'referral-badge-hidden:' || ks) THEN
    DELETE FROM "AppSetting" WHERE key = 'referral-badge-hidden:' || ds;
  ELSE
    UPDATE "AppSetting" SET key = 'referral-badge-hidden:' || ks WHERE key = 'referral-badge-hidden:' || ds;
  END IF;

  ---------------------------------------------------------------- confere e apaga
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = '"User"'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col) INTO leftover USING d;
    IF leftover > 0 THEN
      RAISE EXCEPTION 'merge %->%: ainda há % linha(s) em %.% apontando para a conta apagada', ds, ks, leftover, r.tbl, r.col;
    END IF;
  END LOOP;
  DELETE FROM "User" WHERE id = d;
  RAISE NOTICE 'conta % unificada em %', ds, ks;
END
$f$ LANGUAGE plpgsql;

-- Convite registrado à mão: mesmas regras do app (não convida a si mesmo, ignora se há bloqueio entre as duas),
-- vale este convidador mesmo que já houvesse outro, e as duas pessoas ficam amigas. Conta com mais de 24 h já conta como
-- confirmada para o selo (a pessoa já voltou ao app).
CREATE FUNCTION pg_temp.askout_referral(invitee_name text, inviter_name text) RETURNS void AS $f$
DECLARE
  ie uuid;
  ir uuid;
BEGIN
  SELECT "userId" INTO ie FROM "Profile" WHERE username = invitee_name;
  SELECT "userId" INTO ir FROM "Profile" WHERE username = inviter_name;
  IF ie IS NULL OR ir IS NULL OR ie = ir THEN
    RAISE NOTICE 'convite @% por @%: pulado (conta não encontrada)', invitee_name, inviter_name;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "Block" WHERE ("blockerId" = ie AND "blockedId" = ir) OR ("blockerId" = ir AND "blockedId" = ie)) THEN
    RAISE NOTICE 'convite @% por @%: pulado (bloqueio entre as contas)', invitee_name, inviter_name;
    RETURN;
  END IF;
  INSERT INTO "Referral" ("inviteeId", "inviterId", "createdAt", "qualifiedAt")
  SELECT ie, ir, u."createdAt", CASE WHEN u."createdAt" < now() - interval '24 hours' THEN now() END
    FROM "User" u WHERE u.id = ie
  ON CONFLICT ("inviteeId") DO UPDATE SET
    "inviterId"   = EXCLUDED."inviterId",
    "qualifiedAt" = COALESCE("Referral"."qualifiedAt", EXCLUDED."qualifiedAt");
  INSERT INTO "Follow" ("followerId", "followeeId", status, "createdAt") VALUES (ie, ir, 'ACCEPTED', now()), (ir, ie, 'ACCEPTED', now())
  ON CONFLICT ("followerId", "followeeId") DO UPDATE SET status = 'ACCEPTED';
END
$f$ LANGUAGE plpgsql;

DO $$
DECLARE
  pair text[];
  k uuid;
  d uuid;
BEGIN
  -- {username final, username que some}
  FOREACH pair SLICE 1 IN ARRAY ARRAY[['arianyferreira', 'ariany_f'], ['sylvio', 'sylviofox']] LOOP
    SELECT "userId" INTO k FROM "Profile" WHERE username = pair[1];
    SELECT "userId" INTO d FROM "Profile" WHERE username = pair[2];
    IF d IS NULL THEN
      RAISE NOTICE 'unificação @%: nada a fazer (@% não existe)', pair[1], pair[2];
    ELSIF k IS NULL THEN
      UPDATE "Profile" SET username = pair[1] WHERE "userId" = d;
      RAISE NOTICE 'unificação @%: só existia @%, que passou a se chamar @%', pair[1], pair[2], pair[1];
    ELSE
      PERFORM pg_temp.askout_merge(k, d);
    END IF;
  END LOOP;

  PERFORM pg_temp.askout_referral('gabrielaportes_', 'arianyferreira');
  PERFORM pg_temp.askout_referral('ana', 'arianyferreira');
  PERFORM pg_temp.askout_referral('nadiafelipe', 'arianyferreira');
  PERFORM pg_temp.askout_referral('odavi_silva', 'nadiafelipe');
  PERFORM pg_temp.askout_referral('halanapotter', 'nadiafelipe');
  PERFORM pg_temp.askout_referral('henriquemrt', 'sylvio');
END
$$;

DROP FUNCTION pg_temp.askout_referral(text, text);
DROP FUNCTION pg_temp.askout_merge(uuid, uuid);
DROP FUNCTION pg_temp.askout_move(text, text, uuid, uuid, text[]);
