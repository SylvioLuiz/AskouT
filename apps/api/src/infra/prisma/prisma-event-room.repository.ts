import type { PrismaClient } from '@prisma/client';
import type { EventRoomRepository } from '../../core/ports.ts';
import type { EventAttendanceRecord, EventPostRecord, EventRef, EventStoryMeta, EventStoryRecord, EventStoryReportRecord, Page } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

type PostMeta = Omit<EventPostRecord, 'data'> & { hasImage: boolean };

export class PrismaEventRoomRepository implements EventRoomRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private static where(ref: EventRef) {
    return ref.source === 'PLACE' ? { placeEventId: ref.id } : { postId: ref.id };
  }

  async addGoing(ref: EventRef, userId: string, at: Date): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    const result = await this.prisma.eventAttendance.createMany({ data: [{ userId, createdAt: at, ...PrismaEventRoomRepository.where(ref) }], skipDuplicates: true });
    return result.count > 0;
  }

  async markReminded(ref: EventRef, userId: string, at: Date): Promise<boolean> {
    if (!isUuid(ref.id) || !isUuid(userId)) return false;
    const result = await this.prisma.eventReminder.createMany({ data: [{ userId, source: ref.source, eventId: ref.id, sentAt: at }], skipDuplicates: true });
    return result.count > 0;
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

  async listGoingByUser(userId: string, limit: number): Promise<{ ref: EventRef; createdAt: Date }[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.eventAttendance.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.flatMap((r): { ref: EventRef; createdAt: Date }[] => {
      if (r.placeEventId) return [{ ref: { source: 'PLACE' as const, id: r.placeEventId }, createdAt: r.createdAt }];
      if (r.postId) return [{ ref: { source: 'USER' as const, id: r.postId }, createdAt: r.createdAt }];
      return [];
    });
  }

  async addStory(story: EventStoryRecord): Promise<void> {
    await this.prisma.eventStory.create({
      data: { id: story.id, userId: story.userId, mime: story.mime, isVideo: story.video, data: Buffer.from(story.data), createdAt: story.createdAt, expiresAt: story.expiresAt, ...PrismaEventRoomRepository.where(story.ref) },
    });
  }

  private static storyMeta(r: { id: string; userId: string; placeEventId: string | null; postId: string | null; mime: string; isVideo: boolean; createdAt: Date; expiresAt: Date }): EventStoryMeta | undefined {
    const ref: EventRef | undefined = r.placeEventId ? { source: 'PLACE', id: r.placeEventId } : r.postId ? { source: 'USER', id: r.postId } : undefined;
    return ref ? { id: r.id, ref, userId: r.userId, mime: r.mime, video: r.isVideo, createdAt: r.createdAt, expiresAt: r.expiresAt } : undefined;
  }

  async listStories(ref: EventRef, now: Date): Promise<EventStoryMeta[]> {
    if (!isUuid(ref.id)) return [];
    const rows = await this.prisma.eventStory.findMany({
      where: { ...PrismaEventRoomRepository.where(ref), expiresAt: { gt: now } },
      select: { id: true, userId: true, placeEventId: true, postId: true, mime: true, isVideo: true, createdAt: true, expiresAt: true },
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
    const r = await this.prisma.eventStory.findUnique({ where: { id }, select: { id: true, userId: true, placeEventId: true, postId: true, mime: true, isVideo: true, createdAt: true, expiresAt: true } });
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

  async reportedStoryIds(userId: string, storyIds: string[]): Promise<Set<string>> {
    const ids = storyIds.filter(isUuid);
    if (!isUuid(userId) || ids.length === 0) return new Set();
    const rows = await this.prisma.eventStoryReport.findMany({ where: { reporterId: userId, storyId: { in: ids } }, select: { storyId: true } });
    return new Set(rows.map((r) => r.storyId));
  }

  async addPost(post: EventPostRecord): Promise<void> {
    await this.prisma.eventPost.create({
      data: { id: post.id, eventId: post.eventId, authorId: post.authorId, caption: post.caption, mime: post.mime, data: post.data ? Buffer.from(post.data) : null, createdAt: post.createdAt },
    });
  }

  private static meta(r: { id: string; eventId: string; authorId: string; caption: string; mime: string | null; createdAt: Date }, hasImage: boolean): PostMeta {
    return { id: r.id, eventId: r.eventId, authorId: r.authorId, caption: r.caption, mime: r.mime, createdAt: r.createdAt, hasImage };
  }

  async listPosts(eventId: string, page: Page): Promise<PostMeta[]> {
    if (!isUuid(eventId)) return [];
    const rows = await this.prisma.eventPost.findMany({
      where: { eventId },
      select: { id: true, eventId: true, authorId: true, caption: true, mime: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit,
    });
    return rows.map((r) => PrismaEventRoomRepository.meta(r, r.mime !== null));
  }

  async findPost(id: string): Promise<PostMeta | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.eventPost.findUnique({ where: { id }, select: { id: true, eventId: true, authorId: true, caption: true, mime: true, createdAt: true } });
    return r ? PrismaEventRoomRepository.meta(r, r.mime !== null) : undefined;
  }

  async deletePost(id: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.prisma.eventPost.deleteMany({ where: { id } });
  }

  async findPostImage(id: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.eventPost.findUnique({ where: { id }, select: { mime: true, data: true } });
    return r && r.mime && r.data ? { mime: r.mime, data: new Uint8Array(r.data) } : undefined;
  }

  async setPostsPublic(postId: string, ownerId: string, value: boolean): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(ownerId)) return false;
    const result = await this.prisma.post.updateMany({ where: { id: postId, authorId: ownerId, eventTitle: { not: null } }, data: { eventPostsPublic: value } });
    return result.count > 0;
  }
}
