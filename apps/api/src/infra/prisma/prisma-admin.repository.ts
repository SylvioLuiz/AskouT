import type { Prisma, PrismaClient } from '@prisma/client';
import { isUuid } from './helpers.ts';
import type { AdminCountKind, AdminRepository } from '../../core/ports.ts';
import type {
  AdminConversationReportRow, AdminUserReportRow, AdminPersonRef, AdminEventPerson, AdminPlaceEventExtras, AdminPostDetail, AdminUserExtras, AdminVenueExtras, ClaimStatus, EventKind, FeedPolicy, AdminPlaceEventRow, AdminPostReportRow, AdminPostRow, AdminStats, AdminStoryReportRow, AdminUserRow, AdminVenueRow,
  AuditAction, AuditRecord, AuditRow, ExternalProvider, Page, PageSort, PostReportReason, ReportResolution, UserStatus,
} from '../../core/types.ts';

const MISSING = '(removido)';
/** Quantos itens cada lista ligada traz no detalhe da gestão (a contagem vem inteira). */
const LINKED = 50;

const PERSON = { id: true, profile: { select: { username: true, displayName: true } } } as const;
function person(u: { id: string; profile: { username: string; displayName: string } | null }, at: Date): AdminPersonRef {
  return { id: u.id, username: u.profile?.username ?? MISSING, displayName: u.profile?.displayName ?? '', at };
}
const PERSON_PHOTO = { id: true, profile: { select: { username: true, displayName: true, avatarUrl: true } } } as const;
function personWithPhoto(u: { id: string; profile: { username: string; displayName: string; avatarUrl: string | null } | null }, at: Date): AdminEventPerson {
  return { ...person(u, at), avatarUrl: u.profile?.avatarUrl ?? null };
}

/** Nunca traz os bytes das fotos: só `data` nulo ou não (via filtro) e o id. */
const POST_SELECT = {
  id: true, caption: true, authorId: true, eventTitle: true, eventStartsAt: true, archivedAt: true, createdAt: true,
  author: { select: { profile: { select: { username: true } } } },
  images: { select: { id: true, mime: true, placePhotoRef: true }, orderBy: { position: 'asc' } },
  _count: { select: { reports: true } },
} as const satisfies Prisma.PostSelect;

type PostSelected = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

function toPostRow(p: PostSelected): AdminPostRow {
  const first = p.images.find((i) => i.mime !== null && i.placePhotoRef === null);
  return {
    id: p.id, caption: p.caption, author: { id: p.authorId, username: p.author.profile?.username ?? MISSING }, imagesCount: p.images.length,
    firstImageId: first?.id ?? null, eventTitle: p.eventTitle, eventStartsAt: p.eventStartsAt,
    archived: p.archivedAt !== null, reportsCount: p._count.reports, createdAt: p.createdAt,
  };
}

function contains(text: string) {
  return { contains: text, mode: 'insensitive' as const };
}

export class PrismaAdminRepository implements AdminRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async stats(): Promise<Omit<AdminStats, 'openFeedReports' | 'pendingFeedPosts'>> {
    const p = this.prisma;
    const [users, suspendedUsers, venues, venuesWithOwner, placeEvents, userEvents, posts, pendingClaims, approvedClaims, openPostReports, openConversationReports, openStoryReports, openUserReports] = await Promise.all([
      p.user.count(),
      p.user.count({ where: { status: 'SUSPENDED' } }),
      p.venue.count(),
      p.venue.count({ where: { ownerId: { not: null } } }),
      p.placeEvent.count(),
      p.post.count({ where: { eventTitle: { not: null } } }),
      p.post.count(),
      p.venueClaim.count({ where: { status: 'PENDING' } }),
      p.venueClaim.count({ where: { status: 'APPROVED' } }),
      p.postReport.count({ where: { resolvedAt: null } }),
      p.conversationReport.count({ where: { resolvedAt: null } }),
      p.eventStoryReport.count({ where: { resolvedAt: null } }),
      p.userReport.count({ where: { resolvedAt: null } }),
    ]);
    return { users, suspendedUsers, venues, venuesWithOwner, placeEvents, userEvents, posts, pendingClaims, approvedClaims, openPostReports, openConversationReports, openStoryReports, openUserReports };
  }

  async searchUsers(text: string, status: UserStatus | undefined, page: Page): Promise<AdminUserRow[]> {
    const q = text.trim();
    const where = userWhere(q, status);
    const users = await this.prisma.user.findMany({
      where, orderBy: [...userOrder(page.sort), { id: 'asc' }], skip: page.offset, take: page.limit,
      select: { id: true, email: true, status: true, role: true, createdAt: true, birthDate: true, profile: { select: { username: true, displayName: true } } },
    });
    const ids = users.map((u) => u.id);
    const [posts, postReports, convReports, identities] = await Promise.all([
      this.prisma.post.groupBy({ by: ['authorId'], where: { authorId: { in: ids } }, _count: { _all: true } }),
      this.prisma.postReport.findMany({ where: { post: { authorId: { in: ids } } }, select: { post: { select: { authorId: true } } } }),
      this.prisma.conversationReport.groupBy({ by: ['reportedUserId'], where: { reportedUserId: { in: ids } }, _count: { _all: true } }),
      this.prisma.externalIdentity.findMany({ where: { userId: { in: ids } }, select: { userId: true, provider: true } }),
    ]);
    const providersBy = new Map<string, Set<ExternalProvider>>();
    for (const i of identities) {
      if (i.provider !== 'GOOGLE' && i.provider !== 'APPLE') continue;
      const set = providersBy.get(i.userId) ?? new Set<ExternalProvider>();
      set.add(i.provider);
      providersBy.set(i.userId, set);
    }
    const postsBy = new Map(posts.map((r) => [r.authorId, r._count._all]));
    const reports = new Map<string, number>();
    for (const r of postReports) reports.set(r.post.authorId, (reports.get(r.post.authorId) ?? 0) + 1);
    for (const r of convReports) if (r.reportedUserId) reports.set(r.reportedUserId, (reports.get(r.reportedUserId) ?? 0) + r._count._all);
    return users.map((u) => ({
      id: u.id, email: u.email, username: u.profile?.username ?? MISSING, displayName: u.profile?.displayName ?? '', status: u.status, role: u.role,
      createdAt: u.createdAt, postsCount: postsBy.get(u.id) ?? 0, reportsCount: reports.get(u.id) ?? 0,
      birthDate: u.birthDate ? u.birthDate.toISOString().slice(0, 10) : null,
      loginProviders: [...(providersBy.get(u.id) ?? [])].sort(),
    }));
  }

  async setUserStatus(userId: string, status: UserStatus): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const r = await this.prisma.user.updateMany({ where: { id: userId }, data: { status } });
    return r.count > 0;
  }

  async searchVenues(text: string, page: Page): Promise<AdminVenueRow[]> {
    const q = text.trim();
    const rows = await this.prisma.venue.findMany({
      where: venueWhere(q),
      orderBy: [...venueOrder(page.sort), { id: 'asc' }], skip: page.offset, take: page.limit,
      select: { id: true, name: true, address: true, category: true, isSample: true, owner: { select: { id: true, profile: { select: { username: true } } } }, _count: { select: { events: true } } },
    });
    return rows.map((v) => ({
      id: v.id, name: v.name, address: v.address, category: v.category, isSample: v.isSample,
      owner: v.owner ? { id: v.owner.id, username: v.owner.profile?.username ?? MISSING } : null, eventsCount: v._count.events,
    }));
  }

  async searchPlaceEvents(text: string, page: Page): Promise<AdminPlaceEventRow[]> {
    const q = text.trim();
    const rows = await this.prisma.placeEvent.findMany({
      where: eventWhere(q),
      orderBy: [...eventOrder(page.sort), { id: 'asc' }], skip: page.offset, take: page.limit,
      select: { id: true, title: true, startsAt: true, endsAt: true, kind: true, isSample: true, isFree: true, venue: { select: { id: true, name: true, address: true } } },
    });
    return rows.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind, isSample: e.isSample, isFree: e.isFree, venue: e.venue }));
  }

  async deletePlaceEvent(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.placeEvent.deleteMany({ where: { id } });
    return r.count > 0;
  }

  async searchPosts(text: string, onlyEvents: boolean, page: Page): Promise<AdminPostRow[]> {
    const q = text.trim();
    const where = postWhere(q, onlyEvents);
    const rows = await this.prisma.post.findMany({ where, orderBy: [...postOrder(page.sort), { id: 'asc' }], skip: page.offset, take: page.limit, select: POST_SELECT });
    return rows.map(toPostRow);
  }

  async findPostRow(id: string): Promise<AdminPostRow | undefined> {
    if (!isUuid(id)) return undefined;
    const p = await this.prisma.post.findUnique({ where: { id }, select: POST_SELECT });
    return p ? toPostRow(p) : undefined;
  }

  async deletePost(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.post.deleteMany({ where: { id } });
    return r.count > 0;
  }

  async listPostReports(open: boolean, page: Page): Promise<AdminPostReportRow[]> {
    const rows = await this.prisma.postReport.findMany({
      where: { resolvedAt: open ? null : { not: null } },
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'asc' }],
      skip: page.offset, take: page.limit,
      select: { id: true, reason: true, details: true, createdAt: true, resolvedAt: true, resolution: true, resolutionNote: true, reporter: { select: { id: true, profile: { select: { username: true } } } }, post: { select: POST_SELECT } },
    });
    return rows.map((r) => ({
      id: r.id, reason: r.reason as PostReportReason, details: r.details, createdAt: r.createdAt,
      reporter: { id: r.reporter.id, username: r.reporter.profile?.username ?? MISSING }, post: toPostRow(r.post),
      resolvedAt: r.resolvedAt, resolution: r.resolution as ReportResolution | null, resolutionNote: r.resolutionNote,
    }));
  }

  async listConversationReports(open: boolean, page: Page): Promise<AdminConversationReportRow[]> {
    const rows = await this.prisma.conversationReport.findMany({
      where: { resolvedAt: open ? null : { not: null } },
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'asc' }],
      skip: page.offset, take: page.limit,
      select: {
        id: true, conversationId: true, reason: true, details: true, evidence: true, createdAt: true, resolvedAt: true, resolution: true, resolutionNote: true,
        reporter: { select: { id: true, profile: { select: { username: true } } } },
        reported: { select: { id: true, status: true, profile: { select: { username: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id, conversationId: r.conversationId, reason: r.reason as PostReportReason, details: r.details, evidence: r.evidence, createdAt: r.createdAt,
      reporter: { id: r.reporter.id, username: r.reporter.profile?.username ?? MISSING },
      reported: r.reported ? { id: r.reported.id, username: r.reported.profile?.username ?? MISSING, status: r.reported.status } : null,
      resolvedAt: r.resolvedAt, resolution: r.resolution as ReportResolution | null, resolutionNote: r.resolutionNote,
    }));
  }

  async listUserReports(open: boolean, page: Page): Promise<AdminUserReportRow[]> {
    const rows = await this.prisma.userReport.findMany({
      where: { resolvedAt: open ? null : { not: null } },
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'asc' }],
      skip: page.offset, take: page.limit,
      select: {
        id: true, kind: true, commentId: true, reason: true, details: true, evidence: true, createdAt: true, resolvedAt: true, resolution: true, resolutionNote: true,
        reporter: { select: { id: true, profile: { select: { username: true } } } },
        reported: { select: { id: true, status: true, profile: { select: { username: true } } } },
      },
    });
    const commentIds = rows.map((r) => (r.kind === 'COMMENT' ? r.commentId : null)).filter((id): id is string => id !== null && isUuid(id));
    const existing = new Set(commentIds.length ? (await this.prisma.postComment.findMany({ where: { id: { in: commentIds } }, select: { id: true } })).map((c) => c.id) : []);
    return rows.map((r) => ({
      id: r.id, kind: r.kind === 'COMMENT' ? 'COMMENT' as const : 'PROFILE' as const,
      commentId: r.kind === 'COMMENT' ? r.commentId : null, commentExists: r.kind === 'COMMENT' && r.commentId !== null && existing.has(r.commentId), reason: r.reason as PostReportReason, details: r.details, evidence: r.evidence, createdAt: r.createdAt,
      reporter: { id: r.reporter.id, username: r.reporter.profile?.username ?? MISSING },
      reported: { id: r.reported.id, username: r.reported.profile?.username ?? MISSING, status: r.reported.status },
      resolvedAt: r.resolvedAt, resolution: r.resolution as ReportResolution | null, resolutionNote: r.resolutionNote,
    }));
  }

  async findUserReport(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.userReport.findUnique({ where: { id }, select: { id: true, reportedUserId: true, resolvedAt: true } });
    return r ?? undefined;
  }

  async resolveUserReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.userReport.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note } });
    return r.count > 0;
  }

  async listStoryReports(open: boolean, page: Page): Promise<AdminStoryReportRow[]> {
    const rows = await this.prisma.eventStoryReport.findMany({
      where: { resolvedAt: open ? null : { not: null } },
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'asc' }],
      skip: page.offset, take: page.limit,
      select: {
        id: true, reason: true, details: true, createdAt: true, resolvedAt: true, resolution: true, resolutionNote: true,
        reporter: { select: { id: true, profile: { select: { username: true } } } },
        story: { select: { id: true, isVideo: true, caption: true, overlays: true, userId: true, placeEventId: true, postId: true, createdAt: true, expiresAt: true, user: { select: { profile: { select: { username: true } } } }, placeEvent: { select: { title: true } }, post: { select: { eventTitle: true } }, _count: { select: { reports: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id, reason: r.reason as PostReportReason, details: r.details, createdAt: r.createdAt,
      reporter: { id: r.reporter.id, username: r.reporter.profile?.username ?? MISSING },
      story: {
        id: r.story.id, kind: r.story.isVideo ? 'VIDEO' as const : 'IMAGE' as const, caption: storyText(r.story.caption, r.story.overlays), author: { id: r.story.userId, username: r.story.user.profile?.username ?? MISSING },
        eventId: r.story.placeEventId ?? r.story.postId ?? '', eventTitle: r.story.placeEvent?.title ?? r.story.post?.eventTitle ?? null,
        createdAt: r.story.createdAt, expiresAt: r.story.expiresAt, reportsCount: r.story._count.reports,
      },
      resolvedAt: r.resolvedAt, resolution: r.resolution as ReportResolution | null, resolutionNote: r.resolutionNote,
    }));
  }

  async findStoryReport(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.eventStoryReport.findUnique({ where: { id }, select: { id: true, storyId: true, resolvedAt: true } });
    return r ?? undefined;
  }

  async resolveStoryReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.eventStoryReport.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note } });
    return r.count > 0;
  }

  async findStoryMedia(id: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.eventStory.findUnique({ where: { id }, select: { mime: true, data: true } });
    return r ? { mime: r.mime, data: new Uint8Array(r.data) } : undefined;
  }

  async deleteStory(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.eventStory.deleteMany({ where: { id } });
    return r.count > 0;
  }

  async findPostReport(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.postReport.findUnique({ where: { id }, select: { id: true, postId: true, resolvedAt: true } });
    return r ?? undefined;
  }

  async findConversationReport(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.conversationReport.findUnique({ where: { id }, select: { id: true, reportedUserId: true, resolvedAt: true } });
    return r ?? undefined;
  }

  async resolvePostReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.postReport.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note } });
    return r.count > 0;
  }

  async resolveConversationReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.conversationReport.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note } });
    return r.count > 0;
  }

  async addAudit(record: AuditRecord): Promise<void> {
    await this.prisma.adminAudit.create({
      data: { id: record.id, adminId: record.adminId, action: record.action, targetType: record.targetType, targetId: record.targetId, note: record.note, createdAt: record.createdAt },
    });
  }

  async countList(kind: AdminCountKind, filter: { text?: string; status?: UserStatus; onlyEvents?: boolean; open?: boolean } = {}): Promise<number> {
    const q = (filter.text ?? '').trim();
    const resolved = { resolvedAt: filter.open === false ? { not: null } : null };
    switch (kind) {
      case 'USERS': return this.prisma.user.count({ where: userWhere(q, filter.status) });
      case 'VENUES': return this.prisma.venue.count({ where: venueWhere(q) });
      case 'PLACE_EVENTS': return this.prisma.placeEvent.count({ where: eventWhere(q) });
      case 'POSTS': return this.prisma.post.count({ where: postWhere(q, filter.onlyEvents === true) });
      case 'POST_REPORTS': return this.prisma.postReport.count({ where: resolved });
      case 'CONVERSATION_REPORTS': return this.prisma.conversationReport.count({ where: resolved });
      case 'STORY_REPORTS': return this.prisma.eventStoryReport.count({ where: resolved });
      case 'USER_REPORTS': return this.prisma.userReport.count({ where: resolved });
      case 'AUDIT': return this.prisma.adminAudit.count();
    }
  }

  async listAudit(page: Page): Promise<AuditRow[]> {
    const rows = await this.prisma.adminAudit.findMany({ orderBy: [...auditOrder(page.sort), { id: 'asc' }], skip: page.offset, take: page.limit });
    const ids = [...new Set(rows.map((r) => r.adminId))];
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, username: true } });
    const names = new Map(profiles.map((p) => [p.userId, p.username]));
    return rows.map((r) => ({
      id: r.id, adminId: r.adminId, action: r.action as AuditAction, targetType: r.targetType as AuditRecord['targetType'], targetId: r.targetId,
      note: r.note, createdAt: r.createdAt, adminUsername: names.get(r.adminId) ?? MISSING,
    }));
  }

  async userExtras(userId: string): Promise<AdminUserExtras | undefined> {
    if (!isUuid(userId)) return undefined;
    const p = this.prisma;
    const mutual = { followerId: userId, status: 'ACCEPTED' as const, followee: { following: { some: { followeeId: userId, status: 'ACCEPTED' as const } } } };
    const u = await p.user.findUnique({
      where: { id: userId },
      select: {
        updatedAt: true, termsAcceptedAt: true, termsVersion: true, onboardedAt: true, tastes: true, profilePending: true, passwordless: true, phone: true, phoneVerifiedAt: true,
        profile: { select: { avatarUrl: true, isPrivate: true } },
        mfa: { select: { enabledAt: true } },
        settings: { select: { timeZone: true, shareAvailability: true, openDms: true } },
        region: { select: { lat: true, lng: true, updatedAt: true } },
        referralReceived: { select: { inviter: { select: { id: true, profile: { select: { username: true } } } } } },
        _count: {
          select: {
            followers: { where: { status: 'ACCEPTED' } }, following: { where: { status: 'ACCEPTED' } }, posts: true, eventAttendances: true, feedPosts: true, postComments: true, postLikes: true,
            eventStories: true, venueFollows: true, ownedVenues: true, venueManagerships: { where: { status: 'ACCEPTED' } }, venueClaims: true, postReports: true, userReportsMade: true,
            userReportsReceived: true, blocksMade: true, blockedBy: true, groupMembers: true, conversationParticipations: true, messages: true, referralsMade: true,
          },
        },
      },
    });
    if (!u) return undefined;
    const [friends, friendsCount, followers, following, requests, requestsCount, eventsCreated, eventsCreatedCount, going, posts, owned, managed, followedVenues, claims, groups, convReported, postReported] = await Promise.all([
      p.follow.findMany({ where: mutual, orderBy: { createdAt: 'desc' }, take: LINKED, select: { createdAt: true, followee: { select: PERSON } } }),
      p.follow.count({ where: mutual }),
      p.follow.findMany({ where: { followeeId: userId, status: 'ACCEPTED' }, orderBy: { createdAt: 'desc' }, take: LINKED, select: { createdAt: true, follower: { select: PERSON } } }),
      p.follow.findMany({ where: { followerId: userId, status: 'ACCEPTED' }, orderBy: { createdAt: 'desc' }, take: LINKED, select: { createdAt: true, followee: { select: PERSON } } }),
      p.follow.findMany({ where: { followeeId: userId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: LINKED, select: { createdAt: true, follower: { select: PERSON } } }),
      p.follow.count({ where: { followeeId: userId, status: 'PENDING' } }),
      p.post.findMany({ where: { authorId: userId, eventTitle: { not: null } }, orderBy: { createdAt: 'desc' }, take: LINKED, select: { id: true, eventTitle: true, eventStartsAt: true, eventEndsAt: true, eventPrivate: true, createdAt: true } }),
      p.post.count({ where: { authorId: userId, eventTitle: { not: null } } }),
      p.eventAttendance.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: LINKED,
        select: { createdAt: true, placeEventId: true, postId: true, placeEvent: { select: { title: true, startsAt: true, venue: { select: { name: true } } } }, post: { select: { eventTitle: true, eventStartsAt: true, placeName: true } } },
      }),
      p.post.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, caption: true, eventTitle: true, archivedAt: true, createdAt: true } }),
      p.venue.findMany({ where: { ownerId: userId }, orderBy: { name: 'asc' }, take: LINKED, select: { id: true, name: true } }),
      p.venueManager.findMany({ where: { userId, status: 'ACCEPTED' }, take: LINKED, select: { venue: { select: { id: true, name: true } } } }),
      p.venueFollow.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: LINKED, select: { venue: { select: { id: true, name: true } } } }),
      p.venueClaim.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: LINKED, select: { id: true, venueId: true, status: true, createdAt: true, venue: { select: { name: true } } } }),
      p.groupMember.findMany({ where: { userId }, orderBy: { joinedAt: 'desc' }, take: LINKED, select: { role: true, joinedAt: true, group: { select: { id: true, name: true } } } }),
      p.conversationReport.count({ where: { reportedUserId: userId } }),
      p.postReport.count({ where: { post: { authorId: userId } } }),
    ]);
    const identities = await p.externalIdentity.findMany({ where: { userId }, select: { provider: true } });
    const loginProviders = [...new Set(identities.map((i) => i.provider).filter((x): x is ExternalProvider => x === 'GOOGLE' || x === 'APPLE'))].sort();
    const c = u._count;
    return {
      updatedAt: u.updatedAt, termsAcceptedAt: u.termsAcceptedAt, termsVersion: u.termsVersion, onboardedAt: u.onboardedAt, tastes: u.tastes, profilePending: u.profilePending,
      passwordless: u.passwordless, phone: u.phone, phoneVerifiedAt: u.phoneVerifiedAt, avatarUrl: u.profile?.avatarUrl ?? null, isPrivate: u.profile?.isPrivate ?? false,
      mfaEnabled: u.mfa?.enabledAt != null, settings: u.settings, region: u.region,
      invitedBy: u.referralReceived ? { id: u.referralReceived.inviter.id, username: u.referralReceived.inviter.profile?.username ?? MISSING } : null,
      loginProviders,
      counts: {
        friends: friendsCount, followers: c.followers, following: c.following, followRequests: requestsCount, posts: c.posts, eventsCreated: eventsCreatedCount, eventsGoing: c.eventAttendances,
        feedPosts: c.feedPosts, postComments: c.postComments, postLikes: c.postLikes, stories: c.eventStories, venuesFollowed: c.venueFollows, venuesOwned: c.ownedVenues,
        venuesManaged: c.venueManagerships, claims: c.venueClaims, reportsMade: c.postReports + c.userReportsMade, reportsReceived: c.userReportsReceived + convReported + postReported,
        blocksMade: c.blocksMade, blockedBy: c.blockedBy, groups: c.groupMembers, conversations: c.conversationParticipations, messages: c.messages, referrals: c.referralsMade,
      },
      friends: friends.map((f) => person(f.followee, f.createdAt)),
      followers: followers.map((f) => person(f.follower, f.createdAt)),
      following: following.map((f) => person(f.followee, f.createdAt)),
      followRequests: requests.map((f) => person(f.follower, f.createdAt)),
      eventsCreated: eventsCreated.map((e) => ({ id: e.id, title: e.eventTitle ?? '', startsAt: e.eventStartsAt, endsAt: e.eventEndsAt, private: e.eventPrivate, createdAt: e.createdAt })),
      eventsGoing: going.map((g) => g.placeEventId
        ? { id: g.placeEventId, source: 'PLACE' as const, title: g.placeEvent?.title ?? MISSING, startsAt: g.placeEvent?.startsAt ?? null, venueName: g.placeEvent?.venue.name ?? null, at: g.createdAt }
        : { id: g.postId ?? '', source: 'USER' as const, title: g.post?.eventTitle ?? MISSING, startsAt: g.post?.eventStartsAt ?? null, venueName: g.post?.placeName ?? null, at: g.createdAt }),
      posts: posts.map((x) => ({ id: x.id, caption: x.caption, eventTitle: x.eventTitle, archived: x.archivedAt !== null, createdAt: x.createdAt })),
      venues: [
        ...owned.map((v) => ({ id: v.id, name: v.name, role: 'OWNER' as const })),
        ...managed.map((m) => ({ id: m.venue.id, name: m.venue.name, role: 'MANAGER' as const })),
        ...followedVenues.map((f) => ({ id: f.venue.id, name: f.venue.name, role: 'FOLLOWER' as const })),
      ],
      claims: claims.map((x) => ({ id: x.id, venueId: x.venueId, venueName: x.venue.name, status: x.status as ClaimStatus, createdAt: x.createdAt })),
      groups: groups.map((g) => ({ id: g.group.id, name: g.group.name, role: g.role, joinedAt: g.joinedAt })),
    };
  }

  async venueExtras(venueId: string): Promise<AdminVenueExtras | undefined> {
    if (!isUuid(venueId)) return undefined;
    const p = this.prisma;
    const v = await p.venue.findUnique({
      where: { id: venueId },
      select: {
        createdAt: true, updatedAt: true, externalKey: true, photoRef: true, photoAuthor: true, hoursJson: true, feedPolicy: true,
        _count: { select: { checkins: true, posts: true, feedPosts: true, stories: true, claims: true, offers: true, boosts: true, conversations: true } },
        managers: { orderBy: { createdAt: 'asc' }, select: { status: true, createdAt: true, acceptedAt: true, user: { select: PERSON } } },
        claims: { orderBy: { createdAt: 'desc' }, take: LINKED, select: { id: true, userId: true, status: true, createdAt: true, reviewedAt: true, user: { select: { profile: { select: { username: true } } } } } },
        followers: { orderBy: { createdAt: 'desc' }, take: LINKED, select: { createdAt: true, user: { select: PERSON } } },
      },
    });
    if (!v) return undefined;
    const rating = await p.venueRating.aggregate({ where: { venueId }, _count: { _all: true }, _avg: { stars: true } });
    return {
      createdAt: v.createdAt, updatedAt: v.updatedAt, externalKey: v.externalKey, photoRef: v.photoRef, photoAuthor: v.photoAuthor, hoursJson: v.hoursJson, feedPolicy: v.feedPolicy as FeedPolicy,
      rating: { count: rating._count._all, average: rating._avg.stars === null ? null : Math.round(rating._avg.stars * 10) / 10 },
      counts: v._count,
      managers: v.managers.map((m) => ({ ...person(m.user, m.acceptedAt ?? m.createdAt), status: m.status })),
      claims: v.claims.map((c) => ({ id: c.id, userId: c.userId, username: c.user.profile?.username ?? MISSING, status: c.status as ClaimStatus, createdAt: c.createdAt, reviewedAt: c.reviewedAt })),
      followersSample: v.followers.map((f) => person(f.user, f.createdAt)),
    };
  }

  async placeEventExtras(eventId: string): Promise<AdminPlaceEventExtras | undefined> {
    if (!isUuid(eventId)) return undefined;
    const e = await this.prisma.placeEvent.findUnique({
      where: { id: eventId },
      select: {
        createdAt: true, updatedAt: true, feedPolicy: true,
        _count: { select: { stories: true, feedPosts: true, meetings: true, posts: true, cloakroomTickets: true } },
        hunterLink: { select: { ref: true } },
        cloakroom: { select: { enabled: true, priceCents: true, capacity: true } },
        guestList: { select: { limit: true, closesAt: true, maxCompanions: true } },
      },
    });
    if (!e) return undefined;
    return { createdAt: e.createdAt, updatedAt: e.updatedAt, feedPolicy: e.feedPolicy as FeedPolicy, counts: e._count, hunterRef: e.hunterLink?.ref ?? null, cloakroom: e.cloakroom, guestList: e.guestList };
  }

  async postDetail(postId: string): Promise<AdminPostDetail | undefined> {
    if (!isUuid(postId)) return undefined;
    const p = this.prisma;
    const x = await p.post.findUnique({
      where: { id: postId },
      select: {
        id: true, caption: true, placeName: true, placeAddress: true, eventTitle: true, eventStartsAt: true, eventEndsAt: true, eventKind: true, eventPrivate: true, feedPolicy: true,
        archivedAt: true, editedAt: true, createdAt: true, placeVenueId: true, linkedEventId: true,
        author: { select: PERSON },
        venue: { select: { id: true, name: true } },
        images: { orderBy: { position: 'asc' }, select: { id: true, mime: true, placePhotoRef: true } },
        tags: { orderBy: { createdAt: 'asc' }, select: { createdAt: true, user: { select: PERSON } } },
        attendees: { orderBy: { createdAt: 'asc' }, take: LINKED, select: { createdAt: true, user: { select: PERSON_PHOTO } } },
        comments: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, body: true, createdAt: true, author: { select: { profile: { select: { username: true } } } } } },
        _count: { select: { likes: true, comments: true, reports: true, attendees: true, invites: true, stories: true, feedPosts: true, repostedBy: true } },
      },
    });
    if (!x) return undefined;
    // Convidados que ainda não deram "Eu vou" neste evento.
    const pendingWhere = { postId, user: { eventAttendances: { none: { postId } } } };
    const [pending, pendingCount] = await Promise.all([
      p.eventInvite.findMany({
        where: pendingWhere, orderBy: { createdAt: 'asc' }, take: LINKED,
        select: { createdAt: true, user: { select: PERSON_PHOTO }, invitedBy: { select: { id: true, profile: { select: { username: true } } } } },
      }),
      p.eventInvite.count({ where: pendingWhere }),
    ]);
    const placeVenue = x.placeVenueId && isUuid(x.placeVenueId) ? await p.venue.findUnique({ where: { id: x.placeVenueId }, select: { id: true, name: true } }) : null;
    const c = x._count;
    return {
      id: x.id, caption: x.caption, author: { id: x.author.id, username: x.author.profile?.username ?? MISSING, displayName: x.author.profile?.displayName ?? '' },
      placeName: x.placeName, placeAddress: x.placeAddress, eventTitle: x.eventTitle, eventStartsAt: x.eventStartsAt, eventEndsAt: x.eventEndsAt, eventKind: x.eventKind as EventKind,
      eventPrivate: x.eventPrivate, feedPolicy: x.feedPolicy as FeedPolicy, archivedAt: x.archivedAt, editedAt: x.editedAt, createdAt: x.createdAt, venue: x.venue, placeVenue,
      linkedEventId: x.linkedEventId,
      images: x.images.map((i) => ({ id: i.id, uploaded: i.mime !== null && i.placePhotoRef === null })),
      tagged: x.tags.map((t) => person(t.user, t.createdAt)),
      going: x.attendees.map((a) => personWithPhoto(a.user, a.createdAt)),
      invitedPending: pending.map((i) => ({ ...personWithPhoto(i.user, i.createdAt), invitedBy: i.invitedBy ? { id: i.invitedBy.id, username: i.invitedBy.profile?.username ?? MISSING } : null })),
      invitedPendingCount: pendingCount,
      counts: { likes: c.likes, comments: c.comments, reports: c.reports, attendees: c.attendees, invites: c.invites, stories: c.stories, feedPosts: c.feedPosts, reposts: c.repostedBy },
      recentComments: x.comments.map((m) => ({ id: m.id, username: m.author.profile?.username ?? MISSING, body: m.body, createdAt: m.createdAt })),
    };
  }

  async updateVenueAdminFields(venueId: string, fields: { lat: number; lng: number; isSample: boolean; feedPolicy: FeedPolicy }): Promise<boolean> {
    if (!isUuid(venueId)) return false;
    const r = await this.prisma.venue.updateMany({ where: { id: venueId }, data: fields });
    return r.count > 0;
  }

  async updatePlaceEventAdminFields(eventId: string, fields: { isSample: boolean; feedPolicy: FeedPolicy }): Promise<boolean> {
    if (!isUuid(eventId)) return false;
    const r = await this.prisma.placeEvent.updateMany({ where: { id: eventId }, data: fields });
    return r.count > 0;
  }
}

/** Texto do story para a gestão: o texto único da versão anterior e os textos e figurinhas por cima, juntos. */
function storyText(caption: string | null, overlays: unknown): string | null {
  const parts = [caption, ...(Array.isArray(overlays) ? overlays.map((o) => (o && typeof o === 'object' && typeof (o as { text?: unknown }).text === 'string' ? (o as { text: string }).text : null)) : [])];
  const texts = parts.filter((t): t is string => !!t && t.trim() !== '');
  return texts.length > 0 ? texts.join(' · ') : null;
}

// Ordem das tabelas da gestão: a coluna pedida (ver ADMIN_SORTS) ou a ordem de sempre. O `id` entra depois, para a página não embaralhar.
// Textos que podem faltar (tipo, legenda, data de nascimento) ficam sempre no fim.
function userOrder(sort: PageSort | undefined): Prisma.UserOrderByWithRelationInput[] {
  const d = sort?.dir ?? 'asc';
  switch (sort?.key) {
    case 'username': return [{ profile: { username: d } }];
    case 'email': return [{ email: d }];
    case 'status': return [{ status: d }, { createdAt: 'desc' }];
    case 'posts': return [{ posts: { _count: d } }, { createdAt: 'desc' }];
    case 'birthDate': return [{ birthDate: { sort: d, nulls: 'last' } }];
    case 'createdAt': return [{ createdAt: d }];
    default: return [{ createdAt: 'desc' }];
  }
}

function venueOrder(sort: PageSort | undefined): Prisma.VenueOrderByWithRelationInput[] {
  const d = sort?.dir ?? 'asc';
  switch (sort?.key) {
    case 'category': return [{ category: { sort: d, nulls: 'last' } }, { name: 'asc' }];
    case 'owner': return [{ owner: { profile: { username: d } } }, { name: 'asc' }];
    case 'events': return [{ events: { _count: d } }, { name: 'asc' }];
    case 'name': return [{ name: d }];
    default: return [{ name: 'asc' }];
  }
}

function eventOrder(sort: PageSort | undefined): Prisma.PlaceEventOrderByWithRelationInput[] {
  const d = sort?.dir ?? 'asc';
  switch (sort?.key) {
    case 'title': return [{ title: d }];
    case 'venue': return [{ venue: { name: d } }, { startsAt: 'desc' }];
    case 'kind': return [{ kind: d }, { startsAt: 'desc' }];
    case 'startsAt': return [{ startsAt: d }];
    default: return [{ startsAt: 'desc' }];
  }
}

function postOrder(sort: PageSort | undefined): Prisma.PostOrderByWithRelationInput[] {
  const d = sort?.dir ?? 'asc';
  switch (sort?.key) {
    case 'caption': return [{ caption: { sort: d, nulls: 'last' } }, { createdAt: 'desc' }];
    case 'author': return [{ author: { profile: { username: d } } }, { createdAt: 'desc' }];
    case 'reports': return [{ reports: { _count: d } }, { createdAt: 'desc' }];
    case 'createdAt': return [{ createdAt: d }];
    default: return [{ createdAt: 'desc' }];
  }
}

function auditOrder(sort: PageSort | undefined): Prisma.AdminAuditOrderByWithRelationInput[] {
  const d = sort?.dir ?? 'asc';
  switch (sort?.key) {
    case 'action': return [{ action: d }, { createdAt: 'desc' }];
    case 'targetType': return [{ targetType: d }, { createdAt: 'desc' }];
    case 'createdAt': return [{ createdAt: d }];
    default: return [{ createdAt: 'desc' }];
  }
}

// Os filtros das listas da gestão: a busca e a contagem do total usam os mesmos, para o número bater com a tabela.
function userWhere(q: string, status: UserStatus | undefined): Prisma.UserWhereInput {
  return {
    profile: { isNot: null },
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ email: contains(q) }, { profile: { username: contains(q) } }, { profile: { displayName: contains(q) } }] } : {}),
  };
}
function venueWhere(q: string): Prisma.VenueWhereInput {
  return q ? { OR: [{ name: contains(q) }, { address: contains(q) }] } : {};
}
function eventWhere(q: string): Prisma.PlaceEventWhereInput {
  return q ? { OR: [{ title: contains(q) }, { venue: { name: contains(q) } }] } : {};
}
function postWhere(q: string, onlyEvents: boolean): Prisma.PostWhereInput {
  return {
    ...(onlyEvents ? { eventTitle: { not: null } } : {}),
    ...(q ? { OR: [{ caption: contains(q) }, { eventTitle: contains(q) }, { placeName: contains(q) }, { author: { profile: { username: contains(q) } } }] } : {}),
  };
}
