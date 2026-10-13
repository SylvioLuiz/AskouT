// Formatos que a API devolve (ver apps/api/src/core). Só tipos: nada aqui roda.

export type Role = 'USER' | 'VENUE_OWNER' | 'ADMIN';

export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPrivate: boolean;
}

export interface Profile extends PublicProfile {
  bio: string | null;
}

export type RelationState = 'NONE' | 'PENDING' | 'ACCEPTED';

export interface Relationship {
  isSelf: boolean;
  /** O visitante segue este perfil? */
  following: RelationState;
  /** Este perfil segue o visitante? PENDING = pediu para seguir e espera aprovação. */
  followsYou: RelationState;
  isFriend: boolean;
  blockedByViewer: boolean;
}

export interface ProfileView {
  profile: Profile;
  counts: { followers: number; following: number };
  relationship: Relationship;
  canViewContent: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  profile: PublicProfile;
}

export interface AuthResult {
  user: SessionUser;
  token: string;
}

export interface SignupStarted {
  email: string;
  expiresAt: string;
  resendAvailableAt: string;
}

export interface ConnectionsPage {
  items: PublicProfile[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageRequest {
  limit?: number;
  offset?: number;
}

export interface SignupInput {
  email: string;
  username: string;
  displayName?: string;
  password: string;
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}

// ---------- Agenda ----------

export type SlotState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export interface Slot {
  id: string;
  /** Instantes ISO 8601 em UTC. */
  start: string;
  end: string;
  state: SlotState;
}

export interface SlotInput {
  start: string;
  end: string;
  state: SlotState;
}

export interface FriendAvailability {
  profile: PublicProfile;
  slots: Slot[];
}

export type CompatibilityLevel = 'green' | 'orange' | 'red' | 'awaiting';
export type ParticipantStatus = 'available' | 'partial' | 'unavailable' | 'unknown';

export interface Compatibility {
  start: string;
  end: string;
  level: CompatibilityLevel;
  counts: { total: number; available: number; partial: number; unavailable: number; unknown: number };
  participants: { profile: PublicProfile; status: ParticipantStatus; isMe: boolean }[];
}

export interface BestDatesInput {
  friendIds: string[];
  fromDate: string;
  toDate: string;
  durationMinutes: number;
  earliestStart: string;
  latestStart: string;
  timeZone: string;
  limit: number;
}

// ---------- Flash ----------

export interface FlashStatus {
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  note: string | null;
}

export type InviteDirection = 'SENT' | 'RECEIVED' | 'MATCHED';

export interface FlashInvite {
  id: string;
  direction: InviteDirection;
  other: PublicProfile;
  createdAt: string;
  expiresAt: string;
}

export interface AvailableFriend {
  profile: PublicProfile;
  note: string | null;
  expiresAt: string;
  /** Convite aberto com essa pessoa. A lista nunca traz localização. */
  invite: { id: string; direction: InviteDirection } | null;
}

export interface FlashInvites {
  received: FlashInvite[];
  sent: FlashInvite[];
  matches: FlashInvite[];
}

export interface FlashPosition {
  lat: number;
  lng: number;
  accuracyM: number | null;
  updatedAt: string;
  stale: boolean;
}

export interface FlashMatch {
  inviteId: string;
  other: PublicProfile;
  expiresAt: string;
  /** Relógio do servidor no momento da resposta. */
  now: string;
  me: FlashPosition | null;
  them: FlashPosition | null;
  /** Conversa 1:1 dos dois, criada ao aceitar. */
  conversationId: string;
}

// ---------- Conversas e sugestões ----------

/** Cartão de sugestão de lugar ou evento, enviado numa conversa. Nunca traz a posição de ninguém. */
export interface SuggestionCard {
  source: 'EVENT' | 'OSM' | 'GOOGLE';
  title: string;
  venueName: string;
  lat: number;
  lng: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  externalId: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  mine: boolean;
  kind: 'TEXT' | 'SUGGESTION';
  body: string;
  suggestion: SuggestionCard | null;
  /** Resposta de quem recebeu o cartão. */
  response: 'ACCEPTED' | 'DECLINED' | null;
  respondedAt: string | null;
  /** Distância em linha reta do lugar até cada um, só durante o encontro Flash. */
  distances: { meM: number; themM: number } | null;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  other: PublicProfile;
  lastMessage: ChatMessage | null;
  unread: number;
  canSend: boolean;
}

export interface ChatView {
  id: string;
  other: PublicProfile;
  canSend: boolean;
  /** Relógio do servidor. */
  now: string;
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface SuggestionItem {
  key: string;
  source: 'EVENT' | 'OSM' | 'GOOGLE';
  title: string;
  venueName: string;
  category: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sample: boolean;
  lat: number;
  lng: number;
  /** Nota e avaliações do Google (só quando a fonte é o Google). */
  rating: number | null;
  ratingCount: number | null;
  /** Caminho assinado da foto, relativo à API. */
  photoPath: string | null;
  photoAuthor: string | null;
  mapsUri: string | null;
  distanceFromMeM: number;
  distanceFromThemM: number;
  distanceFromMidM: number;
}

export interface Suggestions {
  reason: 'TOO_FAR' | null;
  radiusM: number;
  placesAvailable: boolean;
  items: SuggestionItem[];
}
