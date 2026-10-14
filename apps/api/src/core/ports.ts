import type { AvailabilitySlotRecord, ConversationRecord, ConversationSummaryRecord, Direction, EventKind, ExternalPlace, MeetupRecord, MessageRecord, NotificationRecord, NotificationType, PostCommentRecord, PostKindFilter, PostPatch, PostReportRecord, PostScope, PushSubscriptionRecord, PlaceEventRecord, VenueRecord, FlashHiddenRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, Follow, FollowStatus, Page, PendingSignup, PostImageRecord, PostRecord, PostTagRecord, PostTagStatus, PostWithImages, Profile, ProfilePhotoRecord, SuggestionResponse, User, UserRole } from './types.ts';

/**
 * Portas (interfaces) que a lógica de negócio precisa. As implementações reais
 * (Prisma/Postgres, JWT de biblioteca etc.) entram depois, sem mudar as regras.
 */

export interface UserRepository {
  /** Cria usuário e perfil juntos. Lança DomainError CONFLICT se e-mail ou username já existirem. */
  create(user: User, profile: Profile): Promise<void>;
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
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
  /** Muda nome, foto (nula apaga) e/ou dono do grupo. */
  updateGroup(conversationId: string, patch: { name?: string; imageUrl?: string | null; ownerId?: string }): Promise<void>;
  /** Conversas do usuário, da mais recente para a mais antiga (por última mensagem, depois criação). */
  listForUser(userId: string, hiddenSenderIds?: readonly string[]): Promise<ConversationSummaryRecord[]>;
  /** Com `audio`, grava os bytes da mensagem de voz junto (mesma operação). */
  addMessage(message: MessageRecord, audio?: { mime: string; data: Uint8Array }): Promise<void>;
  /** Bytes da mensagem de voz (só de mensagens kind AUDIO). */
  findAudio(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined>;
  findMessage(id: string): Promise<MessageRecord | undefined>;
  /** Grava a resposta ao cartão só se ainda não houver uma. Devolve false se já tinha. */
  setSuggestionResponse(messageId: string, response: SuggestionResponse, at: Date): Promise<boolean>;
  /** Mensagens em ordem cronológica. `before` pagina para trás (só as anteriores a esse instante). */
  listMessages(conversationId: string, limit: number, before?: Date, excludeSenderIds?: readonly string[]): Promise<MessageRecord[]>;
  /** Mensagens de voz e textos com link (http/https), da mais recente para a mais antiga. */
  listShared(conversationId: string, limit: number, excludeSenderIds?: readonly string[]): Promise<MessageRecord[]>;
  /** Marca como lida até `now` para `userId`. */
  markRead(conversationId: string, userId: string, now: Date): Promise<void>;
  /** Quantas mensagens `userId` enviou desde `since` (limite de envio). */
  countSentSince(userId: string, since: Date): Promise<number>;
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

/** Eventos que a pessoa decidiu postar no próprio perfil. */
export interface ProfileEventRepository {
  /** Devolve false se já estava postado. */
  add(userId: string, eventId: string, at: Date): Promise<boolean>;
  remove(userId: string, eventId: string): Promise<boolean>;
  has(userId: string, eventId: string): Promise<boolean>;
  /** Mais recentes primeiro. */
  list(userId: string, page: Page): Promise<{ eventId: string; createdAt: Date }[]>;
  count(userId: string): Promise<number>;
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

export interface CoreDeps {
  notifier: Notifier;
  users: UserRepository;
  follows: FollowRepository;
  blocks: BlockRepository;
  availability: AvailabilityRepository;
  flash: FlashRepository;
  conversations: ConversationRepository;
  meetups: MeetupRepository;
  profileEvents: ProfileEventRepository;
  posts: PostRepository;
  places: PlaceRepository;
  placeSource: PlaceSource;
  pending: PendingSignupRepository;
  mailer: EmailSender;
  codes: OneTimeCodes;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  ids: IdGenerator;
}
