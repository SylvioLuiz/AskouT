import type { PrismaClient } from '@prisma/client';
import type { EventRoomRepository } from '../../core/ports.ts';
import type { EventAttendanceRecord, EventPostRecord, EventRef, Page } from '../../core/types.ts';
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
