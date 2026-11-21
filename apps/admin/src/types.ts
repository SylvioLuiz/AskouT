export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
export type UserRole = 'USER' | 'VENUE_OWNER' | 'ADMIN';
export type ReportReason = 'SPAM' | 'OFFENSIVE' | 'NUDITY' | 'VIOLENCE' | 'FALSE_INFO' | 'OTHER';
export type Resolution = 'DISMISSED' | 'ACTIONED';
export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
  /** Quantos registros a lista tem com o mesmo filtro. */
  total: number;
}

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  profile: { username: string; displayName: string };
}

export interface AuthResult {
  token: string;
  user: SessionUser;
}

/** Senha conferida, mas a conta tem verificação em duas etapas: falta o código do app autenticador. */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresInSeconds: number;
}

export interface Stats {
  users: number;
  suspendedUsers: number;
  venues: number;
  venuesWithOwner: number;
  placeEvents: number;
  userEvents: number;
  posts: number;
  pendingClaims: number;
  approvedClaims: number;
  openPostReports: number;
  openConversationReports: number;
  openUserReports: number;
  openStoryReports: number;
  openFeedReports?: number;
  pendingFeedPosts?: number;
}

export interface Claim {
  id: string;
  status: ClaimStatus;
  note: string | null;
  documentMime: string;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  venue: { id: string; name: string; address: string | null; isSample: boolean; ownerId: string | null; isOrganization?: boolean; isUserCreated?: boolean; category?: string | null; description?: string | null };
  user: { id: string; username: string; displayName: string; email: string };
}

export interface UserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: UserStatus;
  role: UserRole;
  createdAt: string;
  postsCount: number;
  reportsCount: number;
  /** AAAA-MM-DD, ou null se a pessoa ainda não informou. */
  birthDate: string | null;
  /** Contas Google/Apple ligadas; vazio = só e-mail e senha. */
  loginProviders: ('GOOGLE' | 'APPLE')[];
}

export interface VenueRow {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  isSample: boolean;
  owner: { id: string; username: string } | null;
  eventsCount: number;
}

/** Detalhe de um local (a gestão abre ao clicar no local da lista). */
export interface VenueDetail {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
  isOrganization: boolean;
  isUserCreated: boolean;
  source: 'GOOGLE' | 'OSM' | 'IMPORT' | null;
  description: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  owner: { id: string; username: string; displayName: string } | null;
  followers: number;
  eventsTotal: number;
  upcomingCount: number;
  events: { id: string; title: string; startsAt: string; endsAt: string; kind: string; isFree: boolean; isSample: boolean; upcoming: boolean }[];
}

/** Detalhe de um evento de local (a gestão abre ao clicar no evento da lista). */
export interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  kind: string;
  isFree: boolean;
  isSample: boolean;
  imageUrl: string | null;
  tags: string[];
  ticketUrl: string | null;
  status: 'UPCOMING' | 'LIVE' | 'PAST';
  venue: { id: string; name: string; address: string | null; owner: { id: string; username: string } | null };
  goingCount: number;
  going: { id: string; username: string; displayName: string; at: string }[];
}

export interface PlaceEventRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  isSample: boolean;
  venue: { id: string; name: string };
}

export interface PostRow {
  id: string;
  caption: string | null;
  author: { id: string; username: string };
  imagesCount: number;
  firstImageId: string | null;
  eventTitle: string | null;
  eventStartsAt: string | null;
  archived: boolean;
  reportsCount: number;
  createdAt: string;
}

export interface PostReportRow {
  id: string;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
  reporter: { id: string; username: string };
  post: PostRow;
  resolvedAt: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
}

/** Publicação do feed de um evento ou rolê. */
export interface FeedPostRow {
  id: string;
  kind: 'POST' | 'NOTICE';
  status: 'PUBLISHED' | 'PENDING';
  body: string | null;
  createdAt: string;
  author: { id: string; username: string };
  place: { type: 'PLACE_EVENT' | 'USER_EVENT' | 'VENUE'; id: string; title: string; url: string };
  imageIds: string[];
  commentsCount: number;
  openReportsCount: number;
}

export interface FeedCommentRow {
  id: string;
  postId: string;
  body: string;
  gifUrl?: string | null;
  createdAt: string;
  author: { id: string; username: string };
  openReportsCount: number;
}

export interface FeedReportRow {
  id: string;
  kind: 'POST' | 'COMMENT';
  reason: ReportReason;
  details: string | null;
  evidence: string;
  createdAt: string;
  reporter: { id: string; username: string };
  reported: { id: string; username: string; status: UserStatus };
  post: FeedPostRow | null;
  commentId: string | null;
  commentAlive: boolean;
  resolvedAt: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
}

export interface VenueStoryReportRow {
  id: string;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
  reporter: { id: string; username: string };
  story: { id: string; kind: 'IMAGE' | 'VIDEO'; venueId: string; venueName: string | null; author: { id: string; username: string } | null; createdAt: string; expiresAt: string };
  /** Pessoas diferentes com denúncia aberta contra o local; a partir de 3 a publicação do local fica suspensa. */
  venueOpenReporters: number;
}

export interface StoryReportRow {
  id: string;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
  reporter: { id: string; username: string };
  story: { id: string; kind: 'IMAGE' | 'VIDEO'; caption?: string | null; author: { id: string; username: string }; eventId: string; eventTitle: string | null; createdAt: string; expiresAt: string; reportsCount: number };
  resolvedAt: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
}

export interface ConversationReportRow {
  id: string;
  conversationId: string;
  reason: ReportReason;
  details: string | null;
  evidence: string;
  createdAt: string;
  reporter: { id: string; username: string };
  reported: { id: string; username: string; status: UserStatus } | null;
  resolvedAt: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
}

export interface UserReportRow {
  id: string;
  kind: 'PROFILE' | 'COMMENT';
  /** Comentário de post denunciado (null em perfil). */
  commentId?: string | null;
  /** O comentário ainda existe. */
  commentExists?: boolean;
  reason: ReportReason;
  details: string | null;
  /** O texto denunciado como estava quando a pessoa denunciou. */
  evidence: string;
  createdAt: string;
  reporter: { id: string; username: string };
  reported: { id: string; username: string; status: UserStatus };
  resolvedAt: string | null;
  resolution: Resolution | null;
  resolutionNote: string | null;
}

export interface AuditRow {
  id: string;
  adminId: string;
  adminUsername: string;
  action: string;
  targetType: string;
  targetId: string;
  note: string | null;
  createdAt: string;
}

// ---------- Pagamentos ----------

export interface PaymentsState {
  /** O que vale agora: ligado só se escolhido E com provedor configurado. */
  enabled: boolean;
  /** O que a gestão escolheu; null se ainda não escolheu (vale o valor inicial do servidor). */
  chosen: boolean | null;
  initial: boolean;
  provider: 'sandbox' | 'stripe' | 'none';
  canEnable: boolean;
  blocker: string | null;
  storeAvailable: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// ---------- Hunter ----------

export interface HunterOverview {
  enabled: boolean;
  /** O servidor tem o token de serviço (HUNTER_SERVICE_TOKEN)? Sem ele o Hunter não liga. */
  serviceConfigured: boolean;
  total: number;
  items: { ref: string; eventId: string; title: string; venueId: string; venueName: string; startsAt: string; createdAt: string }[];
}

// ---------- Retenção ----------

export interface RetentionSource {
  impressions: number;
  clicks: number;
  ctr: number | null;
  avgDwellMs: number | null;
  users: number;
}

export interface RetentionDay {
  day: string;
  activeUsers: number;
  feedImpressions: number;
  recoImpressions: number;
  recoClicks: number;
  feedAvgDwellMs: number | null;
  recoAvgDwellMs: number | null;
}

export interface ReturnRate {
  sample: number;
  returned: number;
  rate: number | null;
}

export interface ReturnGroup {
  all: ReturnRate;
  withReco: ReturnRate;
  withoutReco: ReturnRate;
}

export interface RecoExperimentState {
  enabled: boolean;
  controlPercent: number;
  maxPercent: number;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ProportionDiff {
  diff: number;
  low: number;
  high: number;
  significant: boolean;
}

export interface GroupReturn {
  users: number;
  d1: ReturnRate;
  d7: ReturnRate;
}

export interface ExperimentReport {
  enabled: boolean;
  controlPercent: number;
  from: string;
  to: string;
  control: GroupReturn;
  treatment: GroupReturn;
  d1Diff: ProportionDiff | null;
  d7Diff: ProportionDiff | null;
  lowData: boolean;
  minSample: number;
}

export interface RetentionReport {
  experiment: ExperimentReport | null;
  days: number;
  from: string;
  to: string;
  truncated: boolean;
  sources: { FEED: RetentionSource; RECO: RetentionSource };
  daily: RetentionDay[];
  d1: ReturnGroup;
  d7: ReturnGroup;
  minSample: number;
}

/** Configuração de evento ("Pode fumar?" sim/não, "Estacionamento" texto) que quem cria evento pode responder. */
export interface EventExtra {
  id: string;
  icon: string;
  label: string;
  type: 'YES_NO' | 'TEXT';
}

export interface EventExtraInput {
  icon: string;
  label: string;
  type: EventExtra['type'];
}

/** Gosto de rolê (Bares, Baladas...) que a pessoa escolhe no app. */
export interface Taste {
  id: string;
  icon: string;
  label: string;
  hint: string;
  keywords: string[];
  kinds: string[];
}

export interface TasteInput {
  icon: string;
  label: string;
  hint: string;
  keywords: string;
  kinds: string[];
}

/** Quem mais trouxe gente pelo convite (entraram = todos; confirmados = voltaram ao app em outro dia). */
export interface TopInviter {
  profile: { userId: string; username: string; displayName: string; avatarUrl: string | null };
  brought: number;
  confirmed: number;
}
