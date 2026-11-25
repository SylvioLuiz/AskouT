import type { Prisma, PrismaClient } from '@prisma/client';
import { parseStoryOverlays } from '../../core/story-overlays.ts';
import type { StoryOverlay } from '../../core/story-overlays.ts';
import type { EventRoomRepository } from '../../core/ports.ts';
import type { EventAttendanceRecord, EventRef, EventStoryMeta, EventStoryRecord, EventStoryReportRecord, Page, StoryHiddenRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';
import { decodeReminders, encodeReminders } from '../../core/event-reminders.ts';
import type { EventReminderOption } from '../../core/event-reminders.ts';

export class PrismaEventRoomRepository implements EventRoomRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private static where(ref: EventRef) {
    return ref.source === 'PLACE' ? { placeEventId: ref.id } : { postId: ref.id };
  }

  async addGoing(ref: EventRef, userId: string, at: Date, onProfile = false): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    const result = await this.prisma.eventAttendance.createMany({ data: [{ userId, createdAt: at, onProfile, ...PrismaEventRoomRepository.where(ref) }], skipDuplicates: true });
    return result.count > 0;
  }

  async setGoingOnProfile(ref: EventRef, userId: string, onProfile: boolean): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    const result = await this.prisma.eventAttendance.updateMany({ where: { userId, ...PrismaEventRoomRepository.where(ref) }, data: { onProfile } });
    return result.count > 0;
  }

  async goingOnProfile(ref: EventRef, userId: string): Promise<boolean | undefined> {
    if (!isUuid(ref.id) || !isUuid(userId)) return undefined;
    const row = await this.prisma.eventAttendance.findFirst({ where: { userId, ...PrismaEventRoomRepository.where(ref) }, select: { onProfile: true } });
    return row ? row.onProfile : undefined;
  }

  async markReminded(ref: EventRef, userId: string, kind: EventReminderOption, at: Date): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    const result = await this.prisma.eventReminder.createMany({ data: [{ userId, source: ref.source, eventId: ref.id, kind, sentAt: at }], skipDuplicates: true });
    return result.count > 0;
  }

  async listGoingStartingBetween(from: Date, to: Date, limit: number): Promise<{ ref: EventRef; userId: string; createdAt: Date; startsAt: Date }[]> {
    const rows = await this.prisma.eventAttendance.findMany({
      // Evento adiado não manda lembrete: a data guardada é a antiga.
      where: { OR: [{ placeEvent: { postponedAt: null, startsAt: { gt: from, lte: to } } }, { post: { archivedAt: null, eventPostponedAt: null, eventStartsAt: { gt: from, lte: to } } }] },
      select: { userId: true, createdAt: true, placeEventId: true, postId: true, placeEvent: { select: { startsAt: true } }, post: { select: { eventStartsAt: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.flatMap((r): { ref: EventRef; userId: string; createdAt: Date; startsAt: Date }[] => {
      if (r.placeEventId && r.placeEvent) return [{ ref: { source: 'PLACE' as const, id: r.placeEventId }, userId: r.userId, createdAt: r.createdAt, startsAt: r.placeEvent.startsAt }];
      if (r.postId && r.post?.eventStartsAt) return [{ ref: { source: 'USER' as const, id: r.postId }, userId: r.userId, createdAt: r.createdAt, startsAt: r.post.eventStartsAt }];
      return [];
    });
  }

  async listReminderChoices(refs: EventRef[]): Promise<{ ref: EventRef; userId: string; reminders: EventReminderOption[] }[]> {
    const valid = refs.filter((r) => isUuid(r.id));
    if (valid.length === 0) return [];
    const rows = await this.prisma.eventReminderChoice.findMany({ where: { OR: valid.map((r) => ({ source: r.source, eventId: r.id })) } });
    return rows.map((r) => ({ ref: { source: r.source === 'PLACE' ? 'PLACE' : 'USER', id: r.eventId }, userId: r.userId, reminders: decodeReminders(r.reminders) }));
  }

  async getReminderChoice(ref: EventRef, userId: string): Promise<EventReminderOption[] | undefined> {
    if (!isUuid(ref.id) || !isUuid(userId)) return undefined;
    const row = await this.prisma.eventReminderChoice.findUnique({ where: { userId_source_eventId: { userId, source: ref.source, eventId: ref.id } } });
    return row ? decodeReminders(row.reminders) : undefined;
  }

  async setReminderChoice(ref: EventRef, userId: string, reminders: EventReminderOption[] | null, at: Date): Promise<void> {
    if (!isUuid(ref.id) || !isUuid(userId)) return;
    const key = { userId, source: ref.source, eventId: ref.id };
    if (reminders === null) {
      await this.prisma.eventReminderChoice.deleteMany({ where: key });
      return;
    }
    const data = { reminders: encodeReminders(reminders), updatedAt: at };
    await this.prisma.eventReminderChoice.upsert({ where: { userId_source_eventId: key }, create: { ...key, ...data }, update: data });
  }

  async removeGoing(ref: EventRef, userId: string): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    const result = await this.prisma.eventAttendance.deleteMany({ where: { userId, ...PrismaEventRoomRepository.where(ref) } });
    return result.count > 0;
  }

  async isGoing(ref: EventRef, userId: string): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    return (await this.prisma.eventAttendance.count({ where: { userId, ...PrismaEventRoomRepository.where(ref) } })) > 0;
  }

  async listGoing(ref: EventRef): Promise<EventAttendanceRecord[]> {
    if (!isUuid(ref.id)) return [];
    const rows = await this.prisma.eventAttendance.findMany({ where: PrismaEventRoomRepository.where(ref), orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] });
    return rows.map((r) => ({ userId: r.userId, createdAt: r.createdAt }));
  }

  async countGoing(refs: EventRef[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const ref of refs) out.set(ref.id, 0);
    const place = refs.filter((r) => r.source === 'PLACE' && isUuid(r.id)).map((r) => r.id);
    const user = refs.filter((r) => r.source === 'USER' && isUuid(r.id)).map((r) => r.id);
    if (place.length > 0) {
      const rows = await this.prisma.eventAttendance.groupBy({ by: ['placeEventId'], where: { placeEventId: { in: place } }, _count: { _all: true } });
      for (const r of rows) if (r.placeEventId) out.set(r.placeEventId, r._count._all);
    }
    if (user.length > 0) {
      const rows = await this.prisma.eventAttendance.groupBy({ by: ['postId'], where: { postId: { in: user } }, _count: { _all: true } });
      for (const r of rows) if (r.postId) out.set(r.postId, r._count._all);
    }
    return out;
  }

  async countGoingByUser(refs: EventRef[]): Promise<{ userId: string; count: number }[]> {
    const place = refs.filter((r) => r.source === 'PLACE' && isUuid(r.id)).map((r) => r.id);
    const user = refs.filter((r) => r.source === 'USER' && isUuid(r.id)).map((r) => r.id);
    const or = [...(place.length > 0 ? [{ placeEventId: { in: place } }] : []), ...(user.length > 0 ? [{ postId: { in: user } }] : [])];
    if (or.length === 0) return [];
    const rows = await this.prisma.eventAttendance.groupBy({ by: ['userId'], where: { OR: or }, _count: { _all: true } });
    return rows.map((r) => ({ userId: r.userId, count: r._count._all }));
  }

  async listGoingByUser(userId: string, limit: number): Promise<{ ref: EventRef; createdAt: Date; onProfile: boolean }[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.eventAttendance.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.flatMap((r): { ref: EventRef; createdAt: Date; onProfile: boolean }[] => {
      if (r.placeEventId) return [{ ref: { source: 'PLACE' as const, id: r.placeEventId }, createdAt: r.createdAt, onProfile: r.onProfile }];
      if (r.postId) return [{ ref: { source: 'USER' as const, id: r.postId }, createdAt: r.createdAt, onProfile: r.onProfile }];
      return [];
    });
  }

  async addStory(story: EventStoryRecord): Promise<void> {
    await this.prisma.eventStory.create({
      data: { id: story.id, userId: story.userId, mime: story.mime, isVideo: story.video, onProfile: story.onProfile === true, caption: story.caption ?? null, captionY: story.captionY ?? null, ...(story.overlays?.length ? { overlays: story.overlays as unknown as Prisma.InputJsonValue } : {}), data: Buffer.from(story.data), createdAt: story.createdAt, expiresAt: story.expiresAt, ...PrismaEventRoomRepository.where(story.ref) },
    });
  }

  private static readonly storySelect = { id: true, userId: true, placeEventId: true, postId: true, mime: true, isVideo: true, onProfile: true, caption: true, captionY: true, overlays: true, createdAt: true, expiresAt: true } as const;

  private static storyMeta(r: { id: string; userId: string; placeEventId: string | null; postId: string | null; mime: string; isVideo: boolean; onProfile: boolean; caption: string | null; captionY: number | null; overlays: Prisma.JsonValue | null; createdAt: Date; expiresAt: Date }): EventStoryMeta | undefined {
    const ref: EventRef | undefined = r.placeEventId ? { source: 'PLACE', id: r.placeEventId } : r.postId ? { source: 'USER', id: r.postId } : undefined;
    return ref ? { id: r.id, ref, userId: r.userId, mime: r.mime, video: r.isVideo, onProfile: r.onProfile, caption: r.caption, captionY: r.captionY, ...storedOverlays(r.overlays), createdAt: r.createdAt, expiresAt: r.expiresAt } : undefined;
  }

  async listStories(ref: EventRef, now: Date): Promise<EventStoryMeta[]> {
    if (!isUuid(ref.id)) return [];
    const rows = await this.prisma.eventStory.findMany({
      where: { ...PrismaEventRoomRepository.where(ref), expiresAt: { gt: now } },
      select: PrismaEventRoomRepository.storySelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.flatMap((r) => {
      const meta = PrismaEventRoomRepository.storyMeta(r);
      return meta ? [meta] : [];
    });
  }

  async listProfileStories(userIds: string[], now: Date): Promise<EventStoryMeta[]> {
    const ids = [...new Set(userIds.filter(isUuid))];
    if (ids.length === 0) return [];
    const rows = await this.prisma.eventStory.findMany({
      where: { userId: { in: ids }, onProfile: true, expiresAt: { gt: now } },
      select: PrismaEventRoomRepository.storySelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.flatMap((r) => {
      const meta = PrismaEventRoomRepository.storyMeta(r);
      return meta ? [meta] : [];
    });
  }

  async findStory(id: string): Promise<EventStoryMeta | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.eventStory.findUnique({ where: { id }, select: PrismaEventRoomRepository.storySelect });
    return r ? PrismaEventRoomRepository.storyMeta(r) : undefined;
  }

  async findStoryMedia(id: string): Promise<{ mime: string; data: Uint8Array; expiresAt: Date } | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.eventStory.findUnique({ where: { id }, select: { mime: true, data: true, expiresAt: true } });
    return r ? { mime: r.mime, data: new Uint8Array(r.data), expiresAt: r.expiresAt } : undefined;
  }

  async deleteStory(id: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.prisma.eventStory.deleteMany({ where: { id } });
  }

  async reportStory(report: EventStoryReportRecord): Promise<boolean> {
    if (!isUuid(report.storyId) || !isUuid(report.reporterId)) return false;
    const result = await this.prisma.eventStoryReport.createMany({ data: [{ id: report.id, storyId: report.storyId, reporterId: report.reporterId, reason: report.reason, details: report.details, createdAt: report.createdAt }], skipDuplicates: true });
    return result.count > 0;
  }

  async setStoryLike(storyId: string, userId: string, liked: boolean, at: Date): Promise<boolean> {
    if (!isUuid(storyId) || !isUuid(userId)) return false;
    if (!liked) return (await this.prisma.eventStoryLike.deleteMany({ where: { storyId, userId } })).count > 0;
    if (!(await this.prisma.eventStory.findUnique({ where: { id: storyId }, select: { id: true } }))) return false;
    return (await this.prisma.eventStoryLike.createMany({ data: [{ storyId, userId, createdAt: at }], skipDuplicates: true })).count > 0;
  }

  async recordStoryView(storyId: string, userId: string, at: Date): Promise<boolean> {
    if (!isUuid(storyId) || !isUuid(userId)) return false;
    if (!(await this.prisma.eventStory.findUnique({ where: { id: storyId }, select: { id: true } }))) return false;
    return (await this.prisma.eventStoryView.createMany({ data: [{ storyId, userId, createdAt: at }], skipDuplicates: true })).count > 0;
  }

  async storyViewCounts(storyIds: string[]): Promise<Map<string, number>> {
    const ids = storyIds.filter(isUuid);
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.eventStoryView.groupBy({ by: ['storyId'], where: { storyId: { in: ids } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.storyId, r._count._all] as const));
  }

  async likedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>> {
    const ids = storyIds.filter(isUuid);
    if (!isUuid(userId) || ids.length === 0) return new Set();
    const rows = await this.prisma.eventStoryLike.findMany({ where: { userId, storyId: { in: ids } }, select: { storyId: true } });
    return new Set(rows.map((r) => r.storyId));
  }

  async reportedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>> {
    const ids = storyIds.filter(isUuid);
    if (!isUuid(userId) || ids.length === 0) return new Set();
    const rows = await this.prisma.eventStoryReport.findMany({ where: { reporterId: userId, storyId: { in: ids } }, select: { storyId: true } });
    return new Set(rows.map((r) => r.storyId));
  }

  async setStoryHidden(record: StoryHiddenRecord): Promise<void> {
    const { ownerId, otherId, hideTheirs, hideMine } = record;
    if (!isUuid(ownerId) || !isUuid(otherId)) return;
    if (hideTheirs || hideMine) {
      await this.prisma.storyHidden.upsert({
        where: { ownerId_otherId: { ownerId, otherId } },
        create: { ownerId, otherId, hideTheirs, hideMine },
        update: { hideTheirs, hideMine },
      });
    } else {
      await this.prisma.storyHidden.deleteMany({ where: { ownerId, otherId } });
    }
  }

  async listStoryHidden(userId: string): Promise<StoryHiddenRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.storyHidden.findMany({
      where: { OR: [{ ownerId: userId }, { otherId: userId }] },
      select: { ownerId: true, otherId: true, hideTheirs: true, hideMine: true },
    });
    return rows.map((r) => ({ ownerId: r.ownerId, otherId: r.otherId, hideTheirs: r.hideTheirs, hideMine: r.hideMine }));
  }
}

/** Os textos guardados com o story. Gravados já conferidos; algo estranho no banco é ignorado em vez de derrubar a lista. */
function storedOverlays(raw: Prisma.JsonValue | null): { overlays?: StoryOverlay[] } {
  if (!Array.isArray(raw) || raw.length === 0) return {};
  try {
    const overlays = parseStoryOverlays(raw);
    return overlays ? { overlays } : {};
  } catch {
    return {};
  }
}
