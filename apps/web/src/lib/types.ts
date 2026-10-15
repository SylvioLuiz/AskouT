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
  counts: { followers: number; following: number; events: number };
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

/** Escolhas minhas sobre o Flash entre mim e uma pessoa. */
export interface FlashVisibility {
  /** Eu não vejo o Flash dela. */
  hideTheirs: boolean;
  /** Ela não me vê disponível no Flash. */
  hideMine: boolean;
}

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

export interface MeetupView {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  organizer: PublicProfile;
  event: {
    id: string;
    venueName: string;
    address: string | null;
    kind: EventKind;
    imageUrl: string | null;
    isFree: boolean;
    sample: boolean;
    lat: number;
    lng: number;
  } | null;
  conversationId: string;
  isGroup: boolean;
  groupName: string | null;
  confirmedCount: number;
  invitedCount: number;
  declinedCount: number;
  myStatus: 'ORGANIZER' | 'INVITED' | 'CONFIRMED' | 'DECLINED' | null;
  status: 'ACTIVE' | 'CANCELLED';
  /** Quem organiza pode editar o nome, convidar e cancelar enquanto o encontro não acabou. */
  canManage: boolean;
}

export type NotificationType = 'MESSAGE' | 'MEETUP_INVITE' | 'MEETUP_ACCEPTED' | 'MEETUP_CANCELLED' | 'GROUP_REMOVED' | 'FOLLOW_REQUEST' | 'FOLLOW_ACCEPTED' | 'FLASH_INVITE' | 'POST_TAG' | 'POST_LIKE' | 'POST_COMMENT' | 'VENUE_CLAIM';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Caminho dentro do app. */
  url: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationItem[];
  unread: number;
}

/** Resumo de um evento (cartão na conversa, grade do perfil). */
export interface EventCard {
  id: string;
  title: string;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  venueName: string;
  startsAt: string;
  endsAt: string;
  sample: boolean;
}

export interface PostedEvent extends EventCard {
  postedAt: string;
}

export interface PostedEventsPage {
  items: PostedEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface SharedLink {
  messageId: string;
  url: string;
  senderName: string;
  mine: boolean;
  createdAt: string;
}

export interface SharedVoice {
  messageId: string;
  durationMs: number;
  senderName: string;
  mine: boolean;
  createdAt: string;
}

/** Informações da conversa: quem é, encontros, links e mensagens de voz. */
export interface SharedView {
  type: 'DIRECT' | 'GROUP';
  other: PublicProfile | null;
  name: string | null;
  imageUrl: string | null;
  meetups: MeetupView[];
  links: SharedLink[];
  voice: SharedVoice[];
}

export interface GroupDetails {
  id: string;
  name: string;
  ownerId: string;
  imageUrl: string | null;
  members: { profile: PublicProfile; role: 'OWNER' | 'MEMBER' }[];
  meetups: MeetupView[];
  mediaAvailable: false;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  mine: boolean;
  /** Nome de quem enviou; só em grupo. */
  senderName: string | null;
  kind: 'TEXT' | 'SUGGESTION' | 'MEETUP' | 'SYSTEM' | 'EVENT' | 'AUDIO';
  body: string;
  suggestion: SuggestionCard | null;
  /** Mensagem de voz (kind AUDIO): só a duração; o áudio é baixado ao tocar. */
  audio: { durationMs: number } | null;
  /** Evento compartilhado (kind EVENT). */
  event: EventCard | null;
  /** Cartão do encontro (kind MEETUP). */
  meetup: MeetupView | null;
  /** Resposta de quem recebeu o cartão. */
  response: 'ACCEPTED' | 'DECLINED' | null;
  respondedAt: string | null;
  /** Distância em linha reta do lugar até cada um, só durante o encontro Flash. */
  distances: { meM: number; themM: number } | null;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  type: 'DIRECT' | 'GROUP';
  /** Na conversa 1 a 1, a outra pessoa; no grupo, nulo. */
  other: PublicProfile | null;
  name: string | null;
  imageUrl: string | null;
  memberCount: number;
  lastMessage: ChatMessage | null;
  unread: number;
  canSend: boolean;
}

export interface ChatView {
  id: string;
  type: 'DIRECT' | 'GROUP';
  other: PublicProfile | null;
  name: string | null;
  imageUrl: string | null;
  isOwner: boolean;
  memberCount: number;
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

// ---------- Explorar ----------

export type EventKind = 'DIGITAL' | 'SHOW' | 'CINEMA' | 'THEATER' | 'EXHIBITION' | 'GASTRONOMY' | 'NIGHT' | 'OUTDOOR' | 'SPORT' | 'OTHER';

export interface ExploreEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  venue: { id: string; name: string; address: string | null; category: string | null; lat: number; lng: number };
  distanceM: number | null;
  /** Você já postou este evento no seu perfil. */
  postedByMe?: boolean;
}

export interface EventPost {
  id: string;
  author: PublicProfile;
  caption: string;
  /** Endereço da foto, quando o post tem uma. */
  imagePath: string | null;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}

/** Página do evento: do local (PLACE) ou criado por uma pessoa (USER). */
export interface EventPage {
  id: string;
  source: 'PLACE' | 'USER';
  title: string;
  description: string | null;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  /** Capa: a primeira foto do evento (enviada, do Google ou a imagem do evento do local). */
  coverPath: string | null;
  coverAuthor: string | null;
  venue: { name: string; address: string | null; lat: number | null; lng: number | null };
  tags: string[];
  distanceM: number | null;
  postedByMe: boolean;
  confirmedCount: number;
  going: boolean;
  attendees: PublicProfile[];
  owner: PublicProfile | null;
  isOwner: boolean;
  postsEnabled: boolean;
  postsPublic: boolean;
  canPost: boolean;
  posts: EventPost[];
}

export interface ExplorePlace {
  key: string;
  source: 'ASKOUT' | 'GOOGLE' | 'OSM';
  name: string;
  category: string | null;
  address: string | null;
  lat: number;
  lng: number;
  sample: boolean;
  distanceM: number | null;
  rating: number | null;
  ratingCount: number | null;
  photoPath: string | null;
  photoAuthor: string | null;
  mapsUri: string | null;
}

export interface ExploreResult {
  mode: 'NEARBY' | 'TAG' | 'SEARCH';
  q: string;
  located: boolean;
  radiusKm: number;
  from: string;
  to: string;
  events: ExploreEvent[];
  places: ExplorePlace[];
  people: PublicProfile[];
  tags: { tag: string; count: number }[];
  placesAvailable: boolean;
}

export interface ExploreParams {
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  from?: string;
  to?: string;
  kind?: EventKind;
  free?: boolean;
}

export interface PostImage {
  id: string;
  kind: 'UPLOAD' | 'PLACE';
  /** Caminho na API (foto enviada ou foto do lugar assinada); nulo se a foto do lugar não está disponível. */
  path: string | null;
  photoAuthor: string | null;
}

export interface PostView {
  id: string;
  author: PublicProfile;
  caption: string | null;
  placeName: string | null;
  placeAddress: string | null;
  /** Preenchido quando o post é um evento criado pela pessoa. */
  event: { title: string; kind: EventKind; startsAt: string; endsAt: string } | null;
  createdAt: string;
  images: PostImage[];
  mine: boolean;
  tags: { user: PublicProfile; status: 'PENDING' | 'ACCEPTED' }[];
  /** Sua marcação neste post, se houver. */
  myTag: 'PENDING' | 'ACCEPTED' | 'DECLINED' | null;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  archived: boolean;
  edited: boolean;
}

export interface PostComment {
  id: string;
  author: PublicProfile;
  body: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}

export interface PostCommentsPage {
  items: PostComment[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type ReportReason = 'SPAM' | 'OFFENSIVE' | 'NUDITY' | 'VIOLENCE' | 'FALSE_INFO' | 'OTHER';

export interface PostEdit {
  caption?: string | null;
  placeName?: string | null;
  placeAddress?: string | null;
  event?: { title: string; kind?: EventKind; startsAt: string | null; endsAt?: string | null } | null;
}

export interface PostsPage {
  items: PostView[];
  total: number | null;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Foto de um post a criar: enviada (data URL já reduzida) ou a foto de um lugar. */
export type PostImageInput = string | { photoPath: string; photoAuthor: string | null };

// ---------- Locais (painel do local) ----------

export type ClaimState = 'FREE' | 'MINE' | 'TAKEN' | 'PENDING';
export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface VenueSummary {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  sample: boolean;
}

export interface ClaimableVenue extends VenueSummary {
  state: ClaimState;
}

export interface VenueClaim {
  id: string;
  venue: VenueSummary;
  status: ClaimStatus;
  reviewNote: string | null;
  createdAt: string;
}

export interface MyVenues {
  venues: VenueSummary[];
  claims: VenueClaim[];
}

export interface VenueEvent {
  id: string;
  title: string;
  description: string | null;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  phase: 'UPCOMING' | 'LIVE' | 'PAST';
  sample: boolean;
}

export interface VenuePanel {
  venue: VenueSummary;
  events: VenueEvent[];
}

export interface VenueEventBody {
  title: string;
  description: string | null;
  kind: EventKind;
  startsAt: string;
  endsAt: string | null;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
}
