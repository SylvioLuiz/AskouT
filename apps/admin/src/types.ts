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
  openPostReports: number;
  openConversationReports: number;
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
