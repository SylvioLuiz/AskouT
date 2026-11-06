import type { Prisma, PrismaClient } from '@prisma/client';
import type { FeedRepository } from '../../core/ports.ts';
import type { FeedCommentRecord, FeedCursor, FeedImageInput, FeedPolicy, FeedPostRecord, FeedPostStatus, FeedPostWithImages, FeedReactionStats, FeedTarget } from '../../core/types.ts';
import { isUuid, onlyUuids } from './helpers.ts';

const postSelect = {
  id: true,
  authorId: true,
  placeEventId: true,
  userEventId: true,
  venueId: true,
  kind: true,
  body: true,
  status: true,
  asVenue: true,
  createdAt: true,
  reviewedAt: true,
  images: { select: { id: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.FeedPostSelect;

type PostRow = Prisma.FeedPostGetPayload<{ select: typeof postSelect }>;

export class PrismaFeedRepository implements FeedRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** A coluna do alvo na tabela FeedPost. */
  private static where(target: FeedTarget): Prisma.FeedPostWhereInput {
    if (target.type === 'PLACE_EVENT') return { placeEventId: target.id };
    if (target.type === 'USER_EVENT') return { userEventId: target.id };
    return { venueId: target.id };
  }

  private static toRecord(r: PostRow): FeedPostWithImages {
    const target: FeedTarget = r.placeEventId ? { type: 'PLACE_EVENT', id: r.placeEventId } : r.userEventId ? { type: 'USER_EVENT', id: r.userEventId } : { type: 'VENUE', id: r.venueId ?? '' };
    return {
      post: { id: r.id, target, authorId: r.authorId, kind: r.kind, body: r.body, status: r.status, asVenue: r.asVenue, createdAt: r.createdAt, reviewedAt: r.reviewedAt },
      imageIds: r.images.map((i) => i.id),
    };
  }

  async getPolicy(target: FeedTarget): Promise<FeedPolicy> {
    if (!isUuid(target.id)) return 'OWNER_ONLY';
    const select = { feedPolicy: true } as const;
    const row =
      target.type === 'PLACE_EVENT'
        ? await this.prisma.placeEvent.findUnique({ where: { id: target.id }, select })
        : target.type === 'USER_EVENT'
          ? await this.prisma.post.findUnique({ where: { id: target.id }, select })
          : await this.prisma.venue.findUnique({ where: { id: target.id }, select });
    return row?.feedPolicy ?? 'OWNER_ONLY';
  }

  async setPolicy(target: FeedTarget, policy: FeedPolicy): Promise<boolean> {
    if (!isUuid(target.id)) return false;
    const data = { feedPolicy: policy };
    const result =
      target.type === 'PLACE_EVENT'
        ? await this.prisma.placeEvent.updateMany({ where: { id: target.id }, data })
        : target.type === 'USER_EVENT'
          ? await this.prisma.post.updateMany({ where: { id: target.id, eventTitle: { not: null } }, data })
          : await this.prisma.venue.updateMany({ where: { id: target.id }, data });
    return result.count > 0;
  }

  async createPost(post: FeedPostRecord, images: FeedImageInput[]): Promise<void> {
    await this.prisma.feedPost.create({
      data: {
        id: post.id,
        authorId: post.authorId,
        placeEventId: post.target.type === 'PLACE_EVENT' ? post.target.id : null,
        userEventId: post.target.type === 'USER_EVENT' ? post.target.id : null,
        venueId: post.target.type === 'VENUE' ? post.target.id : null,
        kind: post.kind,
        body: post.body,
        status: post.status,
        asVenue: post.asVenue,
        createdAt: post.createdAt,
        reviewedAt: post.reviewedAt,
        images: { create: images.map((img, position) => ({ id: img.id, position, mime: img.mime, data: Buffer.from(img.data) })) },
      },
    });
  }

  async findPost(id: string): Promise<FeedPostWithImages | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.feedPost.findUnique({ where: { id }, select: postSelect });
    return row ? PrismaFeedRepository.toRecord(row) : undefined;
  }

  async listPosts(target: FeedTarget, query: { status: FeedPostStatus; before?: FeedCursor; limit: number }): Promise<FeedPostWithImages[]> {
    if (!isUuid(target.id)) return [];
    const before = query.before;
    const rows = await this.prisma.feedPost.findMany({
      where: {
        ...PrismaFeedRepository.where(target),
        status: query.status,
        ...(before && isUuid(before.id) ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {}),
      },
      select: postSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });
    return rows.map(PrismaFeedRepository.toRecord);
  }

  async countPosts(target: FeedTarget, status: FeedPostStatus): Promise<number> {
    if (!isUuid(target.id)) return 0;
    return this.prisma.feedPost.count({ where: { ...PrismaFeedRepository.where(target), status } });
  }

  async approvePost(id: string, at: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.feedPost.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PUBLISHED', reviewedAt: at } });
    return result.count > 0;
  }

  async deletePost(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.feedPost.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async findImage(id: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.feedPostImage.findUnique({ where: { id }, select: { mime: true, data: true } });
    return row ? { mime: row.mime, data: new Uint8Array(row.data) } : undefined;
  }

  async setReaction(postId: string, userId: string, emoji: string, at: Date): Promise<void> {
    if (!isUuid(postId) || !isUuid(userId)) return;
    await this.prisma.feedReaction.upsert({ where: { postId_userId: { postId, userId } }, create: { postId, userId, emoji, createdAt: at }, update: { emoji, createdAt: at } });
  }

  async removeReaction(postId: string, userId: string): Promise<void> {
    if (!isUuid(postId) || !isUuid(userId)) return;
    await this.prisma.feedReaction.deleteMany({ where: { postId, userId } });
  }

  private static stats(ids: string[], groups: { id: string; emoji: string; count: number }[], mine: { id: string; emoji: string }[]): FeedReactionStats[] {
    return ids.map((id) => ({
      id,
      mine: mine.find((m) => m.id === id)?.emoji ?? null,
      counts: groups
        .filter((g) => g.id === id)
        .map((g) => ({ emoji: g.emoji, count: g.count }))
        .sort((a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : 1)),
    }));
  }

  async reactionStats(postIds: string[], viewerId: string): Promise<FeedReactionStats[]> {
    const ids = onlyUuids(postIds);
    if (ids.length === 0) return postIds.map((id) => ({ id, counts: [], mine: null }));
    const [groups, mine] = await Promise.all([
      this.prisma.feedReaction.groupBy({ by: ['postId', 'emoji'], where: { postId: { in: ids } }, _count: { _all: true } }),
      isUuid(viewerId) ? this.prisma.feedReaction.findMany({ where: { postId: { in: ids }, userId: viewerId }, select: { postId: true, emoji: true } }) : Promise.resolve([]),
    ]);
    return PrismaFeedRepository.stats(
      postIds,
      groups.map((g) => ({ id: g.postId, emoji: g.emoji, count: g._count._all })),
      mine.map((m) => ({ id: m.postId, emoji: m.emoji })),
    );
  }

  async commentCounts(postIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>(postIds.map((id) => [id, 0]));
    const ids = onlyUuids(postIds);
    if (ids.length === 0) return out;
    const groups = await this.prisma.feedComment.groupBy({ by: ['postId'], where: { postId: { in: ids } }, _count: { _all: true } });
    for (const g of groups) out.set(g.postId, g._count._all);
    return out;
  }

  async addComment(comment: FeedCommentRecord): Promise<void> {
    await this.prisma.feedComment.create({ data: { id: comment.id, postId: comment.postId, authorId: comment.authorId, body: comment.body, createdAt: comment.createdAt } });
  }

  async findComment(id: string): Promise<FeedCommentRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.feedComment.findUnique({ where: { id } });
    return row ? { id: row.id, postId: row.postId, authorId: row.authorId, body: row.body, createdAt: row.createdAt } : undefined;
  }

  async listComments(postId: string, query: { after?: FeedCursor; limit: number }): Promise<FeedCommentRecord[]> {
    if (!isUuid(postId)) return [];
    const after = query.after;
    const rows = await this.prisma.feedComment.findMany({
      where: { postId, ...(after && isUuid(after.id) ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit,
    });
    return rows.map((r) => ({ id: r.id, postId: r.postId, authorId: r.authorId, body: r.body, createdAt: r.createdAt }));
  }

  async deleteComment(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.feedComment.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async setCommentReaction(commentId: string, userId: string, emoji: string, at: Date): Promise<void> {
    if (!isUuid(commentId) || !isUuid(userId)) return;
    await this.prisma.feedCommentReaction.upsert({ where: { commentId_userId: { commentId, userId } }, create: { commentId, userId, emoji, createdAt: at }, update: { emoji, createdAt: at } });
  }

  async removeCommentReaction(commentId: string, userId: string): Promise<void> {
    if (!isUuid(commentId) || !isUuid(userId)) return;
    await this.prisma.feedCommentReaction.deleteMany({ where: { commentId, userId } });
  }

  async commentReactionStats(commentIds: string[], viewerId: string): Promise<FeedReactionStats[]> {
    const ids = onlyUuids(commentIds);
    if (ids.length === 0) return commentIds.map((id) => ({ id, counts: [], mine: null }));
    const [groups, mine] = await Promise.all([
      this.prisma.feedCommentReaction.groupBy({ by: ['commentId', 'emoji'], where: { commentId: { in: ids } }, _count: { _all: true } }),
      isUuid(viewerId) ? this.prisma.feedCommentReaction.findMany({ where: { commentId: { in: ids }, userId: viewerId }, select: { commentId: true, emoji: true } }) : Promise.resolve([]),
    ]);
    return PrismaFeedRepository.stats(
      commentIds,
      groups.map((g) => ({ id: g.commentId, emoji: g.emoji, count: g._count._all })),
      mine.map((m) => ({ id: m.commentId, emoji: m.emoji })),
    );
  }
}
