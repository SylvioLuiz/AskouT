import type { AvailabilitySlotRecord, ConversationRecord, ConversationSummaryRecord, Direction, ExternalPlace, MessageRecord, PlaceEventRecord, VenueRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, Follow, FollowStatus, Page, PendingSignup, Profile, SuggestionResponse, User, UserRole } from './types.ts';

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
  /** Os dois participantes de uma conversa DIRECT. */
  participantIds(conversationId: string): Promise<[string, string] | undefined>;
  /** Conversas do usuário, da mais recente para a mais antiga (por última mensagem, depois criação). */
  listForUser(userId: string): Promise<ConversationSummaryRecord[]>;
  addMessage(message: MessageRecord): Promise<void>;
  findMessage(id: string): Promise<MessageRecord | undefined>;
  /** Grava a resposta ao cartão só se ainda não houver uma. Devolve false se já tinha. */
  setSuggestionResponse(messageId: string, response: SuggestionResponse, at: Date): Promise<boolean>;
  /** Mensagens em ordem cronológica. `before` pagina para trás (só as anteriores a esse instante). */
  listMessages(conversationId: string, limit: number, before?: Date): Promise<MessageRecord[]>;
  /** Marca como lida até `now` para `userId`. */
  markRead(conversationId: string, userId: string, now: Date): Promise<void>;
  /** Quantas mensagens `userId` enviou desde `since` (limite de envio). */
  countSentSince(userId: string, since: Date): Promise<number>;
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

export interface CoreDeps {
  users: UserRepository;
  follows: FollowRepository;
  blocks: BlockRepository;
  availability: AvailabilityRepository;
  flash: FlashRepository;
  conversations: ConversationRepository;
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
