import type { PrismaClient } from '@prisma/client';
import { isUuid } from './helpers.ts';
import type { CalendarRepository } from '../../core/ports.ts';
import type { CalendarDraftRecord, CalendarDraftStatus, EventKind, VenueCalendarRecord } from '../../core/types.ts';

interface DraftRow {
  id: string;
  venueId: string;
  occKey: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  ticketUrl: string | null;
  publishAt: Date;
  status: string;
  edited: boolean;
  notifiedAt: Date | null;
  publishedEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDraft(r: DraftRow): CalendarDraftRecord {
  return { ...r, status: r.status as CalendarDraftStatus };
}

function draftData(d: CalendarDraftRecord) {
  return { title: d.title, description: d.description, startsAt: d.startsAt, endsAt: d.endsAt, kind: d.kind, isFree: d.isFree, imageUrl: d.imageUrl, tags: d.tags, ticketUrl: d.ticketUrl, publishAt: d.publishAt, status: d.status, edited: d.edited, notifiedAt: d.notifiedAt, publishedEventId: d.publishedEventId, updatedAt: d.updatedAt };
}

export class PrismaCalendarRepository implements CalendarRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getConfig(venueId: string): Promise<VenueCalendarRecord | undefined> {
    if (!isUuid(venueId)) return undefined;
    const r = await this.prisma.venueCalendar.findUnique({ where: { venueId } });
    return r ?? undefined;
  }

  async saveConfig(c: VenueCalendarRecord): Promise<void> {
    const data = { url: c.url, leadDays: c.leadDays, enabled: c.enabled, lastSyncAt: c.lastSyncAt, lastError: c.lastError, lastFound: c.lastFound };
    await this.prisma.venueCalendar.upsert({ where: { venueId: c.venueId }, create: { venueId: c.venueId, createdAt: c.createdAt, ...data }, update: data });
  }

  async deleteConfig(venueId: string): Promise<void> {
    if (!isUuid(venueId)) return;
    await this.prisma.$transaction([this.prisma.venueCalendarDraft.deleteMany({ where: { venueId, status: { not: 'PUBLISHED' } } }), this.prisma.venueCalendar.deleteMany({ where: { venueId } })]);
  }

  async listToSync(before: Date, limit: number) {
    return this.prisma.venueCalendar.findMany({ where: { enabled: true, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: before } }] }, orderBy: [{ lastSyncAt: { sort: 'asc', nulls: 'first' } }, { venueId: 'asc' }], take: limit });
  }

  async findDraft(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venueCalendarDraft.findUnique({ where: { id } });
    return r ? toDraft(r) : undefined;
  }

  async findDraftByKey(venueId: string, occKey: string) {
    if (!isUuid(venueId)) return undefined;
    const r = await this.prisma.venueCalendarDraft.findUnique({ where: { venueId_occKey: { venueId, occKey } } });
    return r ? toDraft(r) : undefined;
  }

  async listDrafts(venueId: string, statuses?: CalendarDraftStatus[]) {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.venueCalendarDraft.findMany({ where: { venueId, ...(statuses ? { status: { in: statuses } } : {}) }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], take: 300 });
    return rows.map(toDraft);
  }

  async createDraft(d: CalendarDraftRecord): Promise<void> {
    await this.prisma.venueCalendarDraft.create({ data: { id: d.id, venueId: d.venueId, occKey: d.occKey, createdAt: d.createdAt, ...draftData(d) } });
  }

  async updateDraft(d: CalendarDraftRecord): Promise<void> {
    if (!isUuid(d.id)) return;
    await this.prisma.venueCalendarDraft.updateMany({ where: { id: d.id, status: { not: 'PUBLISHED' } }, data: draftData(d) });
  }

  async moveDraft(id: string, from: CalendarDraftStatus[], to: CalendarDraftStatus, patch?: { notifiedAt?: Date; publishedEventId?: string; at: Date }) {
    if (!isUuid(id)) return false;
    const res = await this.prisma.venueCalendarDraft.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, ...(patch?.notifiedAt ? { notifiedAt: patch.notifiedAt } : {}), ...(patch?.publishedEventId ? { publishedEventId: patch.publishedEventId } : {}), ...(patch ? { updatedAt: patch.at } : {}) },
    });
    return res.count > 0;
  }

  async listToNotify(before: Date, limit: number) {
    const rows = await this.prisma.venueCalendarDraft.findMany({ where: { status: 'WAITING', publishAt: { lte: before } }, orderBy: [{ publishAt: 'asc' }, { id: 'asc' }], take: limit });
    return rows.map(toDraft);
  }

  async listToPublish(now: Date, limit: number) {
    const rows = await this.prisma.venueCalendarDraft.findMany({ where: { status: 'APPROVED', publishAt: { lte: now } }, orderBy: [{ publishAt: 'asc' }, { id: 'asc' }], take: limit });
    return rows.map(toDraft);
  }

  async expire(now: Date) {
    const res = await this.prisma.venueCalendarDraft.updateMany({ where: { status: { in: ['WAITING', 'AWAITING', 'APPROVED'] }, startsAt: { lte: now } }, data: { status: 'DISMISSED', updatedAt: now } });
    return res.count;
  }
}
