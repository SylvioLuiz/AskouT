import type { PrismaClient } from '@prisma/client';
import type { VenueStoryRepository } from '../../core/ports.ts';
import type { Page, PostReportReason, ReportResolution } from '../../core/types.ts';
import type { VenueStoryMeta, VenueStoryPrefs, VenueStoryRecord, VenueStoryReportRecord } from '../../core/venue-story.ts';
import { isUuid } from './helpers.ts';

const metaSelect = { id: true, venueId: true, authorId: true, mime: true, isVideo: true, createdAt: true, expiresAt: true } as const;

const toMeta = (r: { id: string; venueId: string; authorId: string; mime: string; isVideo: boolean; createdAt: Date; expiresAt: Date }): VenueStoryMeta => ({
  id: r.id,
  venueId: r.venueId,
  authorId: r.authorId,
  mime: r.mime,
  video: r.isVideo,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
});

type ReportRow = { id: string; storyId: string; reporterId: string; reason: string; details: string | null; createdAt: Date; resolvedAt: Date | null; resolution: string | null; resolutionNote: string | null };

const toReport = (r: ReportRow): VenueStoryReportRecord => ({
  id: r.id,
  storyId: r.storyId,
  reporterId: r.reporterId,
  reason: r.reason as PostReportReason,
  details: r.details,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
  resolution: r.resolution as ReportResolution | null,
  resolutionNote: r.resolutionNote,
});

export class PrismaVenueStoryRepository implements VenueStoryRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async add(story: VenueStoryRecord): Promise<void> {
    await this.prisma.venueStory.create({
      data: { id: story.id, venueId: story.venueId, authorId: story.authorId, mime: story.mime, isVideo: story.video, data: Buffer.from(story.data), createdAt: story.createdAt, expiresAt: story.expiresAt },
    });
  }

  async find(id: string): Promise<VenueStoryMeta | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venueStory.findUnique({ where: { id }, select: metaSelect });
    return r ? toMeta(r) : undefined;
  }

  async findMedia(id: string): Promise<{ mime: string; data: Uint8Array; expiresAt: Date } | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venueStory.findUnique({ where: { id }, select: { mime: true, data: true, expiresAt: true } });
    return r ? { mime: r.mime, data: new Uint8Array(r.data), expiresAt: r.expiresAt } : undefined;
  }

  async listLive(venueIds: string[], now: Date): Promise<VenueStoryMeta[]> {
    const ids = [...new Set(venueIds.filter(isUuid))];
    if (ids.length === 0) return [];
    const rows = await this.prisma.venueStory.findMany({
      where: { venueId: { in: ids }, expiresAt: { gt: now } },
      select: metaSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map(toMeta);
  }

  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    return (await this.prisma.venueStory.deleteMany({ where: { id } })).count > 0;
  }

  async report(report: VenueStoryReportRecord): Promise<boolean> {
    if (!isUuid(report.storyId) || !isUuid(report.reporterId)) return false;
    // Story apagado no meio do caminho: a chave estrangeira recusa e, para quem denuncia, é como não achar o story.
    try {
      const result = await this.prisma.venueStoryReport.createMany({
        data: [{ id: report.id, storyId: report.storyId, reporterId: report.reporterId, reason: report.reason, details: report.details, createdAt: report.createdAt }],
        skipDuplicates: true,
      });
      return result.count > 0;
    } catch {
      return false;
    }
  }

  async reportedIds(userId: string, storyIds: string[]): Promise<Set<string>> {
    const ids = storyIds.filter(isUuid);
    if (!isUuid(userId) || ids.length === 0) return new Set();
    const rows = await this.prisma.venueStoryReport.findMany({ where: { reporterId: userId, storyId: { in: ids } }, select: { storyId: true } });
    return new Set(rows.map((r) => r.storyId));
  }

  async listReports(open: boolean, page: Page): Promise<VenueStoryReportRecord[]> {
    const rows = await this.prisma.venueStoryReport.findMany({
      where: { resolvedAt: open ? null : { not: null } },
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: page.offset,
      take: page.limit,
    });
    return rows.map(toReport);
  }

  async findReport(id: string): Promise<VenueStoryReportRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venueStoryReport.findUnique({ where: { id } });
    return r ? toReport(r) : undefined;
  }

  async resolveReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date): Promise<boolean> {
    if (!isUuid(id) || !isUuid(adminId)) return false;
    const r = await this.prisma.venueStoryReport.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note } });
    return r.count > 0;
  }

  async countOpenReporters(venueId: string, since: Date): Promise<number> {
    if (!isUuid(venueId)) return 0;
    const rows = await this.prisma.venueStoryReport.findMany({
      where: { resolvedAt: null, createdAt: { gte: since }, story: { venueId } },
      select: { reporterId: true },
      distinct: ['reporterId'],
    });
    return rows.length;
  }

  async setMuted(userId: string, venueId: string, muted: boolean): Promise<void> {
    if (!isUuid(userId) || !isUuid(venueId)) return;
    if (muted) await this.prisma.venueStoryMute.createMany({ data: [{ userId, venueId }], skipDuplicates: true });
    else await this.prisma.venueStoryMute.deleteMany({ where: { userId, venueId } });
  }

  async listMuted(userId: string): Promise<string[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.venueStoryMute.findMany({ where: { userId }, select: { venueId: true }, orderBy: { venueId: 'asc' } });
    return rows.map((r) => r.venueId);
  }

  async getPrefs(userId: string): Promise<VenueStoryPrefs> {
    if (!isUuid(userId)) return { hideAll: false };
    const r = await this.prisma.venueStoryPref.findUnique({ where: { userId } });
    return { hideAll: r?.hideAll ?? false };
  }

  async setPrefs(userId: string, prefs: VenueStoryPrefs): Promise<void> {
    if (!isUuid(userId)) return;
    if (prefs.hideAll) await this.prisma.venueStoryPref.upsert({ where: { userId }, create: { userId, hideAll: true }, update: { hideAll: true } });
    else await this.prisma.venueStoryPref.deleteMany({ where: { userId } });
  }
}
