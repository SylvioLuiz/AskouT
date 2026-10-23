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
}

export interface Claim {
  id: string;
  status: ClaimStatus;
  note: string | null;
  documentMime: string;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  venue: { id: string; name: string; address: string | null; isSample: boolean; ownerId: string | null };
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

export interface StoryReportRow {
  id: string;
  reason: ReportReason;
  details: string | null;
  createdAt: string;
  reporter: { id: string; username: string };
  story: { id: string; kind: 'IMAGE' | 'VIDEO'; author: { id: string; username: string }; eventId: string; eventTitle: string | null; createdAt: string; expiresAt: string; reportsCount: number };
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

export interface RetentionReport {
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
