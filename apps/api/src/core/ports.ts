import type { PollConfirmationRecord, PollParticipantRecord, PollProposalRecord, PollProposalStatus, PollRecord, PollStatus, PollVoteRecord, AvailabilitySlotRecord, ConversationRecord, ConversationPrefsRecord, ConversationReportRecord, ConversationSummaryRecord, Direction, EventAttendanceRecord, EventKind, EventPostRecord, EventRef, ExternalPlace, MeetupRecord, MessageReactionRecord, MessageRecord, NotificationRecord, NotificationType, PostCommentRecord, PostKindFilter, PostPatch, PostReportRecord, PostScope, PushSubscriptionRecord, PlaceEventRecord, VenueRecord, VenueProfilePatch, VenueClaimRecord, ClaimStatus, AdminStats, AdminUserRow, AdminVenueRow, AdminPlaceEventRow, AdminPostRow, AdminPostReportRow, AdminConversationReportRow, AuditRecord, AuditRow, ReportResolution, UserStatus, FlashHiddenRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, Follow, FollowStatus, Page, PendingSignup, PostImageRecord, PostRecord, PostTagRecord, PostTagStatus, PostWithImages, Profile, ProfilePhotoRecord, SuggestionResponse, User, UserRole } from './types.ts';

/**
 * Portas (interfaces) que a lógica de negócio precisa. As implementações reais
 * (Prisma/Postgres, JWT de biblioteca etc.) entram depois, sem mudar as regras.
 */

export interface UserRepository {
  /** Cria usuário e perfil juntos. Lança DomainError CONFLICT se e-mail ou username já existirem. */
  create(user: User, profile: Profile): Promise<void>;
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  /** Contas ativas cujo e-mail (minúsculo, UTF-8) tem esse SHA-256 em hexadecimal. Para achar amigos nos contatos sem receber e-mails em claro. */
  findIdsByEmailHashes(hashes: string[]): Promise<string[]>;
  findProfileById(userId: string): Promise<Profile | undefined>;
  findProfileByUsername(username: string): Promise<Profile | undefined>;
  /** Mantém a ordem de `ids`; ignora ausentes e usuários suspensos. */
  findProfilesByIds(ids: string[]): Promise<Profile[]>;
  updateProfile(profile: Profile): Promise<void>;
  /** Guarda (ou, com `null`, remove) a foto de perfil. */
  setPhoto(userId: string, photo: ProfilePhotoRecord | null): Promise<void>;
  findPhoto(userId: string): Promise<ProfilePhotoRecord | undefined>;
  /** Busca por prefixo de username ou trecho do nome. Ignora suspensos e `excludeIds`. */
  searchProfiles(query: string, limit: number, excludeIds: string[]): Promise<Profile[]>;
}

export interface FollowRepository {
  get(followerId: string, followeeId: string): Promise<Follow | undefined>;
  /** Insere ou atualiza o status, preservando `createdAt` de uma linha existente. */
  save(follow: Follow): Promise<void>;
  delete(followerId: string, followeeId: string): Promise<boolean>;
  /** Remove o seguimento nos dois sentidos entre a e b. */
  deleteBetween(a: string, b: string): Promise<void>;
  /** Mais recentes primeiro. `followers`: quem segue userId; `following`: quem userId segue. */
  list(userId: string, direction: Direction, status: FollowStatus, page: Page): Promise<Follow[]>;
  count(userId: string, direction: Direction, status: FollowStatus): Promise<number>;
  /** Aceita todas as solicitações pendentes recebidas por followeeId. Retorna quantas. */
  acceptAllPending(followeeId: string): Promise<number>;
  /** Seguimento mútuo aceito, sem bloqueio em nenhum sentido (mesma regra da view `friendships`). */
  listFriendIds(userId: string): Promise<string[]>;
}

export interface BlockRepository {
  /** Idempotente. */
  add(blockerId: string, blockedId: string, createdAt: Date): Promise<void>;
  remove(blockerId: string, blockedId: string): Promise<boolean>;
  exists(blockerId: string, blockedId: string): Promise<boolean>;
  existsEitherWay(a: string, b: string): Promise<boolean>;
  listBlockedBy(blockerId: string): Promise<string[]>;
  /** Todos os usuários com bloqueio em qualquer sentido com `userId`. */
  listRelatedIds(userId: string): Promise<string[]>;
}

export interface PendingSignupRepository {
  find(email: string): Promise<PendingSignup | undefined>;
  /** Insere ou substitui o cadastro pendente daquele e-mail. */
  save(pending: PendingSignup): Promise<void>;
  delete(email: string): Promise<void>;
  /**
   * Soma 1 às tentativas erradas de forma ATÔMICA e devolve o novo total
   * (undefined se o cadastro não existir mais). Atômico para que tentativas
   * simultâneas não furem o limite.
   */
  incrementAttempts(email: string): Promise<number | undefined>;
}

export interface AvailabilityRepository {
  /** Insere o horário. Lança DomainError CONFLICT se já houver horário do mesmo usuário que se sobreponha. */
  add(slot: AvailabilitySlotRecord): Promise<void>;
  /** Remove só se o horário for do usuário. Retorna se removeu. */
  delete(userId: string, slotId: string): Promise<boolean>;
  /** Horários dos usuários que se sobrepõem a [from, to), ordenados por início. */
  listForUsers(userIds: string[], from: Date, to: Date): Promise<AvailabilitySlotRecord[]>;
  /** Quantidade de horários do usuário que ainda não terminaram em `since`. */
  countActive(userId: string, since: Date): Promise<number>;
}

export interface FlashRepository {
  /** Sessão ligada e ainda não expirada em `now`. */
  findActiveSession(userId: string, now: Date): Promise<FlashSessionRecord | undefined>;
  listActiveSessions(userIds: string[], now: Date): Promise<FlashSessionRecord[]>;
  /** Insere a sessão. CONFLICT se a pessoa já tem uma ligada e não expirada (uma por vez). */
  createSession(session: FlashSessionRecord, now: Date): Promise<void>;
  /** Encerra a sessão ativa da pessoa. Retorna se havia uma. */
  endSession(userId: string, now: Date): Promise<boolean>;

  /** Insere o convite. CONFLICT se já há um aberto (pendente ou aceito, não expirado) entre os dois, em qualquer sentido. */
  createInvite(invite: FlashInviteRecord, now: Date): Promise<void>;
  getInvite(id: string): Promise<FlashInviteRecord | undefined>;
  /** Atualiza status e datas de um convite existente. Ao sair de ACCEPTED, apaga as posições. */
  saveInvite(invite: FlashInviteRecord): Promise<void>;
  /** Convites em que a pessoa participa, pendentes ou aceitos, ainda não expirados em `now`. */
  listOpenInvitesFor(userId: string, now: Date): Promise<FlashInviteRecord[]>;
  /** Pendentes viram CANCELED e aceitos viram ENDED, e as posições somem. Retorna quantos. */
  closeOpenInvitesOf(userId: string, now: Date): Promise<number>;
  closeOpenInvitesBetween(a: string, b: string, now: Date): Promise<number>;

  /** Grava a ocultação de `ownerId` para `otherId`. Sem nenhum dos dois ligados, a linha some. Idempotente. */
  setHidden(record: FlashHiddenRecord): Promise<void>;
  /** Linhas em que a pessoa é `ownerId` ou `otherId`. */
  listHidden(userId: string): Promise<FlashHiddenRecord[]>;

  upsertPosition(position: FlashPositionRecord): Promise<void>;
  listPositions(inviteId: string): Promise<FlashPositionRecord[]>;

  /**
   * Faxina: convites vencidos viram EXPIRED/ENDED, posições de encontros que não estão mais abertos
   * são apagadas e registros fechados há mais de 24 h saem do banco.
   */
  purgeExpired(now: Date): Promise<{ invites: number; positions: number; removed: number }>;
}

export interface ConversationRepository {
  /** Idempotente: devolve a conversa da dupla, criando (com os dois participantes) se não existir. */
  getOrCreateDirect(a: string, b: string, id: string, now: Date): Promise<ConversationRecord>;
  findById(id: string): Promise<ConversationRecord | undefined>;
  /** Quem participa da conversa (dois na 1 a 1; os que entraram no grupo). */
  participantIds(conversationId: string): Promise<string[] | undefined>;
  /** Cria a conversa de grupo só com quem organiza. */
  createGroup(input: { id: string; name: string; ownerId: string; now: Date }): Promise<ConversationRecord>;
  /** Idempotente: coloca a pessoa no grupo. */
  addParticipant(conversationId: string, userId: string, now: Date): Promise<void>;
  /** Tira a pessoa do grupo (idempotente). Quem entrou primeiro vem primeiro em `participantIds`. */
  removeParticipant(conversationId: string, userId: string): Promise<void>;
  /** Quem é administrador (não inclui o dono) no grupo da conversa. */
  adminIds(conversationId: string): Promise<string[]>;
  /** Faz ou desfaz um administrador. Só vale para quem é membro e não é o dono. */
  setAdmin(conversationId: string, userId: string, admin: boolean): Promise<void>;
  /** Muda nome, foto (nula apaga) e/ou dono do grupo. */
  updateGroup(conversationId: string, patch: { name?: string; imageUrl?: string | null; ownerId?: string }): Promise<void>;
  /** Conversas do usuário, da mais recente para a mais antiga (por última mensagem, depois criação). */
  listForUser(userId: string, hiddenSenderIds?: readonly string[]): Promise<ConversationSummaryRecord[]>;
  /** Com `attachment`, grava junto os bytes (áudio, foto ou vídeo) na mesma operação. */
  addMessage(message: MessageRecord, attachment?: { mime: string; data: Uint8Array }): Promise<void>;
  /** Bytes de uma foto ou vídeo (kind IMAGE ou VIDEO). */
  findMedia(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  /** Apaga para todos: marca `deletedAt`, limpa o texto, os bytes e as reações. Devolve false se já estava apagada. */
  softDeleteMessage(messageId: string, at: Date): Promise<boolean>;
  /** Define a reação da pessoa à mensagem; `emoji` nulo remove. Uma por pessoa. */
  setReaction(messageId: string, userId: string, emoji: string | null, at: Date): Promise<void>;
  listReactions(messageIds: readonly string[]): Promise<MessageReactionRecord[]>;
  /** Fixar e silenciar são só de quem pediu. */
  setPrefs(conversationId: string, userId: string, patch: { pinnedAt?: Date | null; muted?: boolean }): Promise<void>;
  getPrefs(conversationId: string, userId: string): Promise<ConversationPrefsRecord>;
  countPinned(userId: string): Promise<number>;
  /** Quem silenciou a conversa (não recebe aviso das mensagens dela). */
  mutedUserIds(conversationId: string): Promise<string[]>;
  /** Bytes da mensagem de voz (só de mensagens kind AUDIO). */
  findAudio(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  findMessage(id: string): Promise<MessageRecord | undefined>;
  /** Grava a resposta ao cartão só se ainda não houver uma. Devolve false se já tinha. */
  setSuggestionResponse(messageId: string, response: SuggestionResponse, at: Date): Promise<boolean>;
  /** Mensagens em ordem cronológica. `before` pagina para trás (só as anteriores a esse instante). */
  listMessages(conversationId: string, limit: number, before?: Date, excludeSenderIds?: readonly string[], after?: Date): Promise<MessageRecord[]>;
  /** Mensagens de voz, fotos, vídeos e textos com link (http/https), da mais recente para a mais antiga. Sem as apagadas. */
  listShared(conversationId: string, limit: number, excludeSenderIds?: readonly string[], after?: Date): Promise<MessageRecord[]>;
  /** "Limpar conversa": só para `userId`. Mensagens até `at` deixam de aparecer para ele (listas, não lidas e prévia). */
  setCleared(conversationId: string, userId: string, at: Date): Promise<void>;
  /** Quando a pessoa limpou a conversa pela última vez, ou null. */
  getCleared(conversationId: string, userId: string): Promise<Date | null>;
  /** Uma denúncia por pessoa e conversa: denunciar de novo atualiza motivo e detalhes. */
  addReport(report: ConversationReportRecord): Promise<void>;
  /** Marca como lida até `now` para `userId`. */
  markRead(conversationId: string, userId: string, now: Date): Promise<void>;
  /** Quantas mensagens `userId` enviou desde `since` (limite de envio). */
  countSentSince(userId: string, since: Date): Promise<number>;
  /** A pessoa está numa conversa em que o evento (post) foi compartilhado: pode abri-lo mesmo sem seguir o dono. */
  hasPostEventAccess(userId: string, postId: string): Promise<boolean>;
}

export interface MeetupRepository {
  /** Grava o encontro com os participantes (quem organiza já confirmado). */
  create(meetup: MeetupRecord): Promise<void>;
  find(id: string): Promise<MeetupRecord | undefined>;
  /** Encontros de uma conversa, o mais próximo no tempo primeiro. */
  listForConversation(conversationId: string): Promise<MeetupRecord[]>;
  /** Responde ao convite só se ainda estiver INVITED. Devolve false se já respondeu (ou não foi convidado). */
  respond(meetupId: string, userId: string, status: 'CONFIRMED' | 'DECLINED', at: Date): Promise<boolean>;
  /** Muda o título e/ou o estado (cancelar). */
  update(meetupId: string, patch: { title?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<void>;
  /** Convida (ou convida de novo quem recusou). Quem já confirmou ou está convidado fica como está. Devolve os que ficaram INVITED agora. */
  invite(meetupId: string, userIds: string[]): Promise<string[]>;
  /** Quem sai ou é removido do grupo deixa de constar nos encontros dele: CONFIRMED e INVITED viram DECLINED (menos quem organiza). */
  declineAllFor(conversationId: string, userId: string, at: Date): Promise<void>;
  /** Encontros em que a pessoa organiza ou foi convidada, o mais recente primeiro. */
  listForUser(userId: string, limit: number): Promise<MeetupRecord[]>;
  /** Quantos encontros a pessoa criou desde `since` (limite de criação). */
  countCreatedSince(userId: string, since: Date): Promise<number>;
}

/** Votação de datas: votação, participantes, votos, propostas e confirmações. */
export interface SchedulingRepository {
  /** Grava a votação com os participantes (quem organiza inclusive). */
  create(poll: PollRecord, participantIds: string[], at: Date): Promise<void>;
  find(id: string): Promise<PollRecord | undefined>;
  /** A votação que gerou este evento (post), se houver. */
  findByEventPost(postId: string): Promise<PollRecord | undefined>;
  /** Votações de uma conversa, a mais recente primeiro. */
  listForConversation(conversationId: string): Promise<PollRecord[]>;
  /** Votações ainda em votação cujo prazo já passou e que ainda não avisaram ninguém. */
  listDeadlinePassed(now: Date, limit: number): Promise<PollRecord[]>;
  /** Votações abertas (votando ou confirmando) em que a pessoa participa, a mais recente primeiro. */
  listOpenForUser(userId: string, limit: number): Promise<PollRecord[]>;
  listParticipants(pollId: string): Promise<PollParticipantRecord[]>;
  listVotes(pollId: string): Promise<PollVoteRecord[]>;
  /** Define (ou, com `null`, apaga) o voto da pessoa nos dias. Um voto por pessoa, votação e dia. */
  setVotes(pollId: string, userId: string, dates: string[], status: 'YES' | 'MAYBE' | 'NO' | null, at: Date): Promise<void>;
  /** "Concluí minha votação" (ou `null` para reabrir). */
  setFinished(pollId: string, userId: string, at: Date | null): Promise<void>;
  updatePoll(pollId: string, patch: { status?: PollStatus; title?: string; finalProposalId?: string | null; meetupId?: string | null; votingClosedAt?: Date | null; eventPostId?: string | null; deadlineNotifiedAt?: Date | null }): Promise<void>;
  createProposal(proposal: PollProposalRecord): Promise<void>;
  findProposal(id: string): Promise<PollProposalRecord | undefined>;
  /** Propostas da votação, a mais recente primeiro. */
  listProposals(pollId: string): Promise<PollProposalRecord[]>;
  updateProposal(id: string, patch: { status: PollProposalStatus }): Promise<void>;
  /** Uma resposta por pessoa e proposta (a nova substitui a anterior). */
  setConfirmation(proposalId: string, pollId: string, userId: string, status: 'CONFIRMED' | 'ADJUST' | 'DECLINED', at: Date): Promise<void>;
  listConfirmations(proposalId: string): Promise<PollConfirmationRecord[]>;
}

/** Eventos que a pessoa decidiu postar no próprio perfil. */
export interface ProfileEventRepository {
  /** Devolve false se já estava postado. */
  add(userId: string, eventId: string, at: Date): Promise<boolean>;
  remove(userId: string, eventId: string): Promise<boolean>;
  has(userId: string, eventId: string): Promise<boolean>;
  /** Mais recentes primeiro. `postId` vem quando o item é um evento criado por outra pessoa e repostado. */
  list(userId: string, page: Page): Promise<{ eventId: string; postId?: string; createdAt: Date }[]>;
  /** Conta eventos de local e de pessoas repostados. */
  count(userId: string): Promise<number>;
  /** Repostar um evento criado por outra pessoa (um post). Devolve false se já estava. */
  addPost(userId: string, postId: string, at: Date): Promise<boolean>;
  removePost(userId: string, postId: string): Promise<boolean>;
  hasPost(userId: string, postId: string): Promise<boolean>;
}

export interface PostRepository {
  create(post: PostRecord, images: PostImageRecord[]): Promise<void>;
  findById(id: string): Promise<PostWithImages | undefined>;
  /** Posts escritos por qualquer um de `authorIds` OU em que alguém de `taggedIds` aceitou a marcação. Mais recentes primeiro. */
  listFor(authorIds: string[], taggedIds: string[], page: Page, only?: PostKindFilter, scope?: PostScope): Promise<PostWithImages[]>;
  /** Mesma regra de `listFor`, para uma pessoa só (escritos por ela ou em que ela aceitou a marcação). */
  countFor(userId: string, only?: PostKindFilter): Promise<number>;
  createTags(postId: string, userIds: string[], at: Date): Promise<void>;
  tagsFor(postIds: string[]): Promise<PostTagRecord[]>;
  /** Muda o status de uma marcação existente. Devolve false se a pessoa não foi marcada nesse post. */
  respondTag(postId: string, userId: string, status: PostTagStatus): Promise<boolean>;
  /** Posts em que `userId` foi marcado e ainda não respondeu, mais recentes primeiro. */
  listPendingTags(userId: string, page: Page): Promise<PostWithImages[]>;
  /** Só apaga se `authorId` é o autor. Devolve false se não existia ou era de outra pessoa. */
  delete(postId: string, authorId: string): Promise<boolean>;
  /** Troca legenda, lugar e dados do evento. Só o autor. Devolve false se não existe ou é de outra pessoa. */
  update(postId: string, authorId: string, patch: PostPatch): Promise<boolean>;
  /** Arquiva (`at`) ou desarquiva (`null`). Só o autor. */
  setArchived(postId: string, authorId: string, at: Date | null): Promise<boolean>;
  /** Arquivados do autor, mais recentes primeiro. */
  listArchived(authorId: string, page: Page): Promise<PostWithImages[]>;
  /**
   * Troca os bytes de uma foto enviada do post (ajuste/recorte). A foto ganha um id novo (`newId`) para o endereço dela mudar
   * e nenhum cache mostrar a versão antiga. Devolve false se a foto não é desse post ou é de lugar.
   */
  replaceImage(postId: string, imageId: string, newId: string, mime: string, data: Uint8Array): Promise<boolean>;
  /** "Não tenho interesse": o post some das listas de `userId` (`listFor` com `scope.hideFor`). */
  hide(postId: string, userId: string): Promise<void>;
  like(postId: string, userId: string, at: Date): Promise<void>;
  unlike(postId: string, userId: string): Promise<void>;
  /** Curtidas de cada post e se `viewerId` curtiu. */
  likeStats(postIds: string[], viewerId: string): Promise<{ postId: string; count: number; liked: boolean }[]>;
  addComment(comment: PostCommentRecord): Promise<void>;
  findComment(id: string): Promise<PostCommentRecord | undefined>;
  /** Mais antigos primeiro. */
  listComments(postId: string, page: Page): Promise<PostCommentRecord[]>;
  deleteComment(id: string): Promise<void>;
  commentCounts(postIds: string[]): Promise<{ postId: string; count: number }[]>;
  /** Uma denúncia por pessoa e post (denunciar de novo troca o motivo). */
  report(report: PostReportRecord): Promise<void>;
  /** Bytes de uma foto enviada (fotos de lugar não têm bytes). */
  findImage(imageId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
}

export interface PlaceRepository {
  createVenue(venue: VenueRecord): Promise<void>;
  createEvent(event: PlaceEventRecord): Promise<void>;
  /**
   * Eventos que acontecem entre `from` e `to` (em andamento ou que começam nesse intervalo) em locais a até
   * `radiusM` metros de `center`. Mais perto primeiro. O filtro por distância é exato, não só por caixa.
   */
  findEventsNear(
    center: { lat: number; lng: number },
    radiusM: number,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<{ event: PlaceEventRecord; venue: VenueRecord }[]>;
  /** Busca de eventos para o Explorar. Sem `center`, não filtra por distância. Mais cedo primeiro, depois mais perto. */
  searchEvents(query: EventSearchQuery): Promise<{ event: PlaceEventRecord; venue: VenueRecord; distanceM: number | null }[]>;
  findEvent(id: string): Promise<{ event: PlaceEventRecord; venue: VenueRecord } | undefined>;
  /** Hashtags de eventos que ainda não acabaram, com a contagem, filtradas pelo começo do texto. */
  listTags(prefix: string, from: Date, to: Date, limit: number): Promise<{ tag: string; count: number }[]>;
  /** Locais do AskouT pelo nome (qualquer parte). Sem `center`, não filtra por distância. */
  searchVenues(text: string, center: { lat: number; lng: number } | undefined, radiusM: number, limit: number): Promise<{ venue: VenueRecord; distanceM: number | null }[]>;
  findVenue(id: string): Promise<VenueRecord | undefined>;
  listVenuesByOwner(ownerId: string): Promise<VenueRecord[]>;
  /** Todos os eventos do local (passados também), do mais novo para o mais antigo. */
  listVenueEvents(venueId: string): Promise<PlaceEventRecord[]>;
  /** Troca os campos editáveis; false se o evento não é do local. */
  updateEvent(venueId: string, event: PlaceEventRecord): Promise<boolean>;
  deleteEvent(venueId: string, eventId: string): Promise<boolean>;
  /** Capa enviada pelo dono do local (bytes no banco). */
  setEventCover(eventId: string, mime: string, data: Uint8Array): Promise<void>;
  clearEventCover(eventId: string): Promise<void>;
  findEventCover(eventId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  /** Define o dono (null tira). Só no aceite de uma reivindicação. */
  setVenueOwner(venueId: string, ownerId: string | null): Promise<void>;
  /** Troca o que o dono edita no perfil (nome, endereço, categoria, descrição, horários e endereço da capa). */
  updateVenueProfile(venueId: string, patch: VenueProfilePatch): Promise<void>;
  /** Capa enviada do aparelho (bytes no banco). */
  setVenueCover(venueId: string, mime: string, data: Uint8Array): Promise<void>;
  clearVenueCover(venueId: string): Promise<void>;
  findVenueCover(venueId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  /** Logo enviada do aparelho (bytes no banco). */
  setVenueLogo(venueId: string, mime: string, data: Uint8Array): Promise<void>;
  clearVenueLogo(venueId: string): Promise<void>;
  findVenueLogo(venueId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  /** Local que entrou de uma fonte externa ("google:ID"). */
  findVenueByExternalKey(key: string): Promise<VenueRecord | undefined>;
  followVenue(userId: string, venueId: string, at: Date): Promise<void>;
  unfollowVenue(userId: string, venueId: string): Promise<void>;
  isFollowingVenue(userId: string, venueId: string): Promise<boolean>;
  countVenueFollowers(venueId: string): Promise<number>;
  listFollowedVenueIds(userId: string): Promise<string[]>;
  /** Nota de 1 a 5 do local: uma por pessoa; avaliar de novo troca a nota. */
  rateVenue(userId: string, venueId: string, stars: number, at: Date): Promise<void>;
  clearVenueRating(userId: string, venueId: string): Promise<void>;
  venueRating(venueId: string, userId: string): Promise<{ count: number; sum: number; mine: number | null }>;
}

export interface VenueClaimRepository {
  create(claim: VenueClaimRecord, document: Uint8Array): Promise<void>;
  findById(id: string): Promise<VenueClaimRecord | undefined>;
  listByUser(userId: string): Promise<VenueClaimRecord[]>;
  /** Mais antigos primeiro. */
  listByStatus(status: ClaimStatus, limit: number): Promise<VenueClaimRecord[]>;
  hasPending(venueId: string, userId: string): Promise<boolean>;
  /** Só muda um pedido pendente; false se já foi decidido. */
  review(id: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, reviewNote: string | null, at: Date): Promise<boolean>;
  findDocument(id: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
}

/** Consultas e ações de gestão que cruzam várias tabelas. Só o painel admin usa. */
export interface AdminRepository {
  stats(): Promise<AdminStats>;
  /** Busca em e-mail, @usuário e nome. Mais novos primeiro. */
  searchUsers(text: string, status: UserStatus | undefined, page: Page): Promise<AdminUserRow[]>;
  setUserStatus(userId: string, status: UserStatus): Promise<boolean>;
  searchVenues(text: string, page: Page): Promise<AdminVenueRow[]>;
  searchPlaceEvents(text: string, page: Page): Promise<AdminPlaceEventRow[]>;
  deletePlaceEvent(id: string): Promise<boolean>;
  /** Posts (inclusive os que são eventos de pessoas). `onlyEvents`: só os com dados de evento. */
  searchPosts(text: string, onlyEvents: boolean, page: Page): Promise<AdminPostRow[]>;
  findPostRow(id: string): Promise<AdminPostRow | undefined>;
  deletePost(id: string): Promise<boolean>;
  listPostReports(open: boolean, page: Page): Promise<AdminPostReportRow[]>;
  listConversationReports(open: boolean, page: Page): Promise<AdminConversationReportRow[]>;
  findPostReport(id: string): Promise<{ id: string; postId: string; resolvedAt: Date | null } | undefined>;
  findConversationReport(id: string): Promise<{ id: string; reportedUserId: string | null; resolvedAt: Date | null } | undefined>;
  /** Só encerra denúncia em aberto; false se já foi decidida. */
  resolvePostReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean>;
  resolveConversationReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean>;
  addAudit(record: AuditRecord): Promise<void>;
  listAudit(page: Page): Promise<AuditRow[]>;
}

export interface EventSearchQuery {
  center?: { lat: number; lng: number };
  radiusM?: number;
  /** Em andamento ou que começam entre `from` e `to`. */
  from: Date;
  to: Date;
  kind?: EventKind;
  freeOnly?: boolean;
  /** Hashtag (sem #): o evento tem alguma hashtag que começa com isto. */
  tagPrefix?: string;
  /** Texto: qualquer parte do título, do nome do local ou de uma hashtag. */
  text?: string;
  /** Só eventos destes locais. */
  venueIds?: string[];
  limit: number;
}

/** Fonte externa de lugares (OpenStreetMap). Nunca lança: se não conseguir, devolve `available: false`. */
export interface PlaceSource {
  nearby(center: { lat: number; lng: number }, radiusM: number, limit: number): Promise<{ available: boolean; places: ExternalPlace[] }>;
}

export interface EmailSender {
  /** Falha com erro comum se o e-mail não puder ser enviado. */
  sendSignupCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>;
}

export interface OneTimeCodes {
  /** Código numérico de 6 dígitos, com zeros à esquerda. */
  generate(): string;
  /** Hash do código amarrado ao e-mail, para guardar no banco. */
  hash(email: string, code: string): string;
  /** Comparação em tempo constante. */
  matches(email: string, code: string, expectedHash: string): boolean;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export interface TokenClaims {
  userId: string;
  role: UserRole;
}

export interface TokenService {
  issue(claims: TokenClaims): string;
  /** Retorna undefined para token inválido, adulterado ou expirado. */
  verify(token: string): TokenClaims | undefined;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface NotificationRepository {
  create(record: NotificationRecord): Promise<void>;
  /** Mais recentes primeiro. */
  listForUser(userId: string, limit: number): Promise<NotificationRecord[]>;
  unreadCount(userId: string): Promise<number>;
  /** Já existe aviso não lido com essa chave? */
  hasUnread(userId: string, dedupeKey: string): Promise<boolean>;
  /** Marca como lidos (todos se `ids` for omitido). Devolve quantos mudaram. */
  markRead(userId: string, now: Date, ids?: string[]): Promise<number>;
}

export interface PushSubscriptionRepository {
  /** Um endpoint pertence a uma pessoa só: se já existia, passa para quem inscreveu agora. */
  upsert(record: PushSubscriptionRecord): Promise<void>;
  remove(endpoint: string, userId?: string): Promise<void>;
  listForUser(userId: string): Promise<PushSubscriptionRecord[]>;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Caminho dentro do app que abre ao tocar. */
  url: string;
  /** Avisos com a mesma `tag` se substituem na tela do aparelho. */
  tag: string;
}

/** SENT: entregue ao serviço de push; GONE: a inscrição não vale mais (apagar); FAILED: erro passageiro. */
export type PushResult = 'SENT' | 'GONE' | 'FAILED';

export interface PushSender {
  /** Chave pública que o navegador usa para se inscrever; `null` se o envio não está configurado. */
  readonly publicKey: string | null;
  send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult>;
}

/** Cria o aviso dentro do app e tenta o push. Nunca lança erro: falha de aviso não derruba a ação principal. */
export interface Notifier {
  notify(input: { userId: string; type: NotificationType; title: string; body: string; url: string; dedupeKey?: string }): Promise<void>;
}

/** Presença ("Eu vou") e posts dentro de eventos criados por pessoas. */
export interface EventRoomRepository {
  /** Confirma presença. Devolve false se já estava confirmada. */
  addGoing(ref: EventRef, userId: string, at: Date): Promise<boolean>;
  removeGoing(ref: EventRef, userId: string): Promise<boolean>;
  isGoing(ref: EventRef, userId: string): Promise<boolean>;
  /** Quem confirmou, na ordem da confirmação (mais antigo primeiro). */
  listGoing(ref: EventRef): Promise<EventAttendanceRecord[]>;
  /** Números de confirmados de vários eventos de uma vez. */
  countGoing(refs: EventRef[]): Promise<Map<string, number>>;
  addPost(post: EventPostRecord): Promise<void>;
  /** Mais recentes primeiro, sem os bytes da foto. */
  listPosts(eventId: string, page: Page): Promise<(Omit<EventPostRecord, 'data'> & { hasImage: boolean })[]>;
  findPost(id: string): Promise<(Omit<EventPostRecord, 'data'> & { hasImage: boolean }) | undefined>;
  deletePost(id: string): Promise<void>;
  findPostImage(id: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  /** Liga/desliga a publicação aberta. Só o dono. Devolve false se o evento não existe ou é de outra pessoa. */
  setPostsPublic(postId: string, ownerId: string, value: boolean): Promise<boolean>;
}

export interface CoreDeps {
  notifier: Notifier;
  users: UserRepository;
  follows: FollowRepository;
  blocks: BlockRepository;
  availability: AvailabilityRepository;
  flash: FlashRepository;
  conversations: ConversationRepository;
  meetups: MeetupRepository;
  scheduling: SchedulingRepository;
  profileEvents: ProfileEventRepository;
  posts: PostRepository;
  eventRoom: EventRoomRepository;
  places: PlaceRepository;
  claims: VenueClaimRepository;
  admin: AdminRepository;
  placeSource: PlaceSource;
  pending: PendingSignupRepository;
  mailer: EmailSender;
  codes: OneTimeCodes;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  ids: IdGenerator;
}
