import type { Prisma, PrismaClient } from '@prisma/client';
import { isUuid } from './helpers.ts';
import type { AdminRepository } from '../../core/ports.ts';
import type {
  AdminConversationReportRow, AdminPlaceEventRow, AdminPostReportRow, AdminPostRow, AdminStats, AdminUserRow, AdminVenueRow,
  AuditAction, AuditRecord, AuditRow, Page, PostReportReason, ReportResolution, UserStatus,
} from '../../core/types.ts';

const MISSING = '(removido)';

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

  async stats(): Promise<AdminStats> {
    const p = this.prisma;
    const [users, suspendedUsers, venues, venuesWithOwner, placeEvents, userEvents, posts, pendingClaims, openPostReports, openConversationReports] = await Promise.all([
      p.user.count(),
      p.user.count({ where: { status: 'SUSPENDED' } }),
      p.venue.count(),
      p.venue.count({ where: { ownerId: { not: null } } }),
      p.placeEvent.count(),
      p.post.count({ where: { eventTitle: { not: null } } }),
      p.post.count(),
      p.venueClaim.count({ where: { status: 'PENDING' } }),
      p.postReport.count({ where: { resolvedAt: null } }),
      p.conversationReport.count({ where: { resolvedAt: null } }),
    ]);
    return { users, suspendedUsers, venues, venuesWithOwner, placeEvents, userEvents, posts, pendingClaims, openPostReports, openConversationReports };
  }

  async searchUsers(text: string, status: UserStatus | undefined, page: Page): Promise<AdminUserRow[]> {
    const q = text.trim();
    const where: Prisma.UserWhereInput = {
      profile: { isNot: null },
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ email: contains(q) }, { profile: { username: contains(q) } }, { profile: { displayName: contains(q) } }] } : {}),
    };
    const users = await this.prisma.user.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: page.offset, take: page.limit,
      select: { id: true, email: true, status: true, role: true, createdAt: true, profile: { select: { username: true, displayName: true } } },
    });
    const ids = users.map((u) => u.id);
    const [posts, postReports, convReports] = await Promise.all([
      this.prisma.post.groupBy({ by: ['authorId'], where: { authorId: { in: ids } }, _count: { _all: true } }),
      this.prisma.postReport.findMany({ where: { post: { authorId: { in: ids } } }, select: { post: { select: { authorId: true } } } }),
      this.prisma.conversationReport.groupBy({ by: ['reportedUserId'], where: { reportedUserId: { in: ids } }, _count: { _all: true } }),
    ]);
    const postsBy = new Map(posts.map((r) => [r.authorId, r._count._all]));
    const reports = new Map<string, number>();
    for (const r of postReports) reports.set(r.post.authorId, (reports.get(r.post.authorId) ?? 0) + 1);
    for (const r of convReports) if (r.reportedUserId) reports.set(r.reportedUserId, (reports.get(r.reportedUserId) ?? 0) + r._count._all);
    return users.map((u) => ({
      id: u.id, email: u.email, username: u.profile?.username ?? MISSING, displayName: u.profile?.displayName ?? '', status: u.status, role: u.role,
      createdAt: u.createdAt, postsCount: postsBy.get(u.id) ?? 0, reportsCount: reports.get(u.id) ?? 0,
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
      where: q ? { OR: [{ name: contains(q) }, { address: contains(q) }] } : {},
      orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: page.offset, take: page.limit,
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
      where: q ? { OR: [{ title: contains(q) }, { venue: { name: contains(q) } }] } : {},
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }], skip: page.offset, take: page.limit,
      select: { id: true, title: true, startsAt: true, endsAt: true, kind: true, isSample: true, venue: { select: { id: true, name: true } } },
    });
    return rows.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind, isSample: e.isSample, venue: e.venue }));
  }

  async deletePlaceEvent(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const r = await this.prisma.placeEvent.deleteMany({ where: { id } });
    return r.count > 0;
  }

  async searchPosts(text: string, onlyEvents: boolean, page: Page): Promise<AdminPostRow[]> {
    const q = text.trim();
    const where: Prisma.PostWhereInput = {
      ...(onlyEvents ? { eventTitle: { not: null } } : {}),
      ...(q ? { OR: [{ caption: contains(q) }, { eventTitle: contains(q) }, { placeName: contains(q) }, { author: { profile: { username: contains(q) } } }] } : {}),
    };
    const rows = await this.prisma.post.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: page.offset, take: page.limit, select: POST_SELECT });
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

  async listAudit(page: Page): Promise<AuditRow[]> {
    const rows = await this.prisma.adminAudit.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: page.offset, take: page.limit });
    const ids = [...new Set(rows.map((r) => r.adminId))];
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, username: true } });
    const names = new Map(profiles.map((p) => [p.userId, p.username]));
    return rows.map((r) => ({
      id: r.id, adminId: r.adminId, action: r.action as AuditAction, targetType: r.targetType as AuditRecord['targetType'], targetId: r.targetId,
      note: r.note, createdAt: r.createdAt, adminUsername: names.get(r.adminId) ?? MISSING,
    }));
  }
}
