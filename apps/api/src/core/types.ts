export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
export type UserRole = 'USER' | 'VENUE_OWNER' | 'ADMIN';
export type FollowStatus = 'PENDING' | 'ACCEPTED';
export type SlotState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export interface User {
  id: string;
  email: string; // sempre minúsculo
  passwordHash: string;
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
}

export interface Profile {
  userId: string;
  username: string; // sempre minúsculo
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isPrivate: boolean;
}

export interface Follow {
  followerId: string;
  followeeId: string;
  status: FollowStatus;
  createdAt: Date;
}

/**
 * Cadastro aguardando o código enviado por e-mail. A conta (User + Profile) só é
 * criada depois da confirmação. Guarda o hash da senha, nunca a senha nem o código.
 */
export interface PendingSignup {
  email: string; // chave; sempre minúsculo
  username: string;
  displayName: string;
  passwordHash: string;
  codeHash: string;
  expiresAt: Date;
  /** Tentativas erradas de código. */
  attempts: number;
  /** Códigos enviados nesta janela de cadastro. */
  sendCount: number;
  lastSentAt: Date;
  createdAt: Date;
}

/** Dados de perfil que qualquer usuário autenticado pode ver em listas e buscas. */
export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPrivate: boolean;
}

export interface Page {
  limit: number;
  offset: number;
}

export type Direction = 'followers' | 'following';

/** Quem está fazendo a requisição, já autenticado. */
export interface Actor {
  userId: string;
  role: UserRole;
}

export function toPublicProfile(p: Profile): PublicProfile {
  return {
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    isPrivate: p.isPrivate,
  };
}

export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 100;

export function normalizePage(input?: Partial<Page>): Page {
  const rawLimit = Number.isFinite(input?.limit) ? Math.trunc(input!.limit!) : DEFAULT_PAGE_LIMIT;
  const rawOffset = Number.isFinite(input?.offset) ? Math.trunc(input!.offset!) : 0;
  return {
    limit: Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT),
    offset: Math.max(rawOffset, 0),
  };
}

/** Horário informado manualmente por uma pessoa. Intervalo semiaberto [startsAt, endsAt). */
export interface AvailabilitySlotRecord {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  state: SlotState;
  createdAt: Date;
}

/** Flash ligado por uma pessoa: ela está disponível "agora" até `expiresAt`. */
export interface FlashSessionRecord {
  id: string;
  userId: string;
  startsAt: Date;
  expiresAt: Date;
  /** Preenchido quando a pessoa desliga antes do fim. */
  endedAt: Date | null;
  note: string | null;
}

export type FlashInviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'EXPIRED' | 'ENDED';

/** Convite entre dois amigos com Flash ligado. ACCEPTED é o "encontro": só nele a posição é compartilhada. */
export interface FlashInviteRecord {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FlashInviteStatus;
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  endedAt: Date | null;
}

/** Última posição de uma pessoa num encontro. Sem histórico: cada atualização substitui a anterior. */
export interface FlashPositionRecord {
  inviteId: string;
  userId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  updatedAt: Date;
}

// ---------- Conversas ----------

export type MessageKind = 'TEXT' | 'SUGGESTION';

/** Conversa 1 a 1 entre amigos. `directKey` = "<menor id>:<maior id>", único por dupla. */
export interface ConversationRecord {
  id: string;
  directKey: string;
  createdAt: Date;
}

/** Cartão de sugestão enviado numa conversa. Não carrega nada sobre onde as pessoas estão. */
export interface SuggestionCard {
  source: 'EVENT' | 'OSM';
  title: string;
  venueName: string;
  lat: number;
  lng: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Dado de teste (nunca apresentado como real). */
  sample: boolean;
  /** Id do evento no AskouT ou do elemento no OpenStreetMap, para evitar duplicatas. */
  externalId: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  suggestion: SuggestionCard | null;
  createdAt: Date;
}

export interface ConversationSummaryRecord {
  conversation: ConversationRecord;
  participantIds: [string, string];
  lastMessage: MessageRecord | null;
  unread: number;
}

// ---------- Lugares e eventos ----------

export interface VenueRecord {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
}

export interface PlaceEventRecord {
  id: string;
  venueId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  isSample: boolean;
}

/** Lugar vindo de uma fonte externa (OpenStreetMap). */
export interface ExternalPlace {
  externalId: string;
  name: string;
  category: string | null;
  lat: number;
  lng: number;
}
