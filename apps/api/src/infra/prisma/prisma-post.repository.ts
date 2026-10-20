import type { PrismaClient } from '@prisma/client';
import type { PostRepository } from '../../core/ports.ts';
import type { EngagementRow, Page, PostCommentRecord, PostPatch, PostReportRecord, PostScope, PostKindFilter, PostImageRecord, PostRecord, PostTagRecord, PostTagStatus, PostWithImages } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

export class PrismaPostRepository implements PostRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(post: PostRecord, images: PostImageRecord[]): Promise<void> {
    await this.prisma.post.create({
      data: {
        id: post.id,
        authorId: post.authorId,
        caption: post.caption,
        placeName: post.placeName,
        placeAddress: post.placeAddress,
        eventTitle: post.eventTitle,
        eventStartsAt: post.eventStartsAt,
        eventEndsAt: post.eventEndsAt,
        eventKind: post.eventKind,
        eventPostsPublic: post.eventPostsPublic,
        eventPrivate: post.eventPrivate ?? false,
        archivedAt: post.archivedAt,
        editedAt: post.editedAt,
        createdAt: post.createdAt,
        venueId: post.venueId ?? null,
        images: {
          create: images.map((i) => ({
            id: i.id,
            position: i.position,
            mime: i.mime,
            data: i.data ? Buffer.from(i.data) : null,
            placePhotoRef: i.placePhotoRef,
            placePhotoAuthor: i.placePhotoAuthor,
            videoMime: i.videoMime ?? null,
            videoData: i.videoData ? Buffer.from(i.videoData) : null,
          })),
        },
      },
    });
  }

  private static toView(row: {
    id: string;
    authorId: string;
    caption: string | null;
    placeName: string | null;
    placeAddress: string | null;
    eventTitle: string | null;
    eventStartsAt: Date | null;
    eventEndsAt: Date | null;
    eventKind: PostRecord['eventKind'];
    eventPostsPublic: boolean;
    eventPrivate: boolean;
    archivedAt: Date | null;
    editedAt: Date | null;
    createdAt: Date;
    venueId?: string | null;
    images: { id: string; position: number; mime: string | null; placePhotoRef: string | null; placePhotoAuthor: string | null; videoMime: string | null }[];
  }): PostWithImages {
    return {
      post: { id: row.id, authorId: row.authorId, caption: row.caption, placeName: row.placeName, placeAddress: row.placeAddress, eventTitle: row.eventTitle, eventStartsAt: row.eventStartsAt, eventEndsAt: row.eventEndsAt, eventKind: row.eventKind, eventPostsPublic: row.eventPostsPublic, eventPrivate: row.eventPrivate, archivedAt: row.archivedAt, editedAt: row.editedAt, createdAt: row.createdAt, venueId: row.venueId ?? null },
      images: row.images.map((i) => ({ id: i.id, position: i.position, isUpload: i.mime !== null, placePhotoRef: i.placePhotoRef, placePhotoAuthor: i.placePhotoAuthor, videoMime: i.videoMime })),
    };
  }

  // Não traz os bytes das fotos nem dos vídeos: só os campos de metadados.
  private static readonly include = {
    images: { select: { id: true, position: true, mime: true, placePhotoRef: true, placePhotoAuthor: true, videoMime: true }, orderBy: { position: 'asc' as const } },
  };

  async findById(id: string): Promise<PostWithImages | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.post.findUnique({ where: { id }, include: PrismaPostRepository.include });
    return row ? PrismaPostRepository.toView(row) : undefined;
  }

  private static viaTag(taggedIds: string[]) {
    return { tags: { some: { userId: { in: taggedIds }, status: 'ACCEPTED' } } };
  }

  private static kindWhere(only?: PostKindFilter) {
    return only === undefined ? {} : only === 'EVENT' ? { eventTitle: { not: null } } : { eventTitle: null };
  }

  async listFor(authorIds: string[], taggedIds: string[], page: Page, only?: PostKindFilter, scope: PostScope = {}): Promise<PostWithImages[]> {
    const authors = authorIds.filter(isUuid);
    const tagged = taggedIds.filter(isUuid);
    const venues = (scope.venueIds ?? []).filter(isUuid);
    // Posts em nome de um local só entram pelo local (seguido ou da página), nunca pelo perfil de quem postou.
    const or = [
      ...(authors.length > 0 ? [{ authorId: { in: authors }, venueId: null }] : []),
      ...(tagged.length > 0 ? [{ AND: [PrismaPostRepository.viaTag(tagged), { venueId: null }] }] : []),
      ...(venues.length > 0 ? [{ venueId: { in: venues } }] : []),
    ];
    if (or.length === 0) return [];
    const rows = await this.prisma.post.findMany({
      where: {
        AND: [
          { OR: or },
          PrismaPostRepository.kindWhere(only),
          scope.archived ? { archivedAt: { not: null } } : { archivedAt: null },
          ...(scope.hideFor && isUuid(scope.hideFor) ? [{ hiddenBy: { none: { userId: scope.hideFor } } }] : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit,
      include: PrismaPostRepository.include,
    });
    return rows.map(PrismaPostRepository.toView);
  }

  async listEventsStartingBetween(from: Date, to: Date, limit: number): Promise<PostWithImages[]> {
    const rows = await this.prisma.post.findMany({
      where: { archivedAt: null, eventStartsAt: { gt: from, lte: to } },
      orderBy: [{ eventStartsAt: 'asc' }, { id: 'asc' }],
      take: limit,
      include: PrismaPostRepository.include,
    });
    return rows.map(PrismaPostRepository.toView);
  }

  async countFor(userId: string, only?: PostKindFilter): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.post.count({ where: { AND: [{ OR: [{ authorId: userId }, PrismaPostRepository.viaTag([userId])] }, { venueId: null }, PrismaPostRepository.kindWhere(only), { archivedAt: null }] } });
  }

  async createTags(postId: string, userIds: string[], at: Date): Promise<void> {
    const ids = userIds.filter(isUuid);
    if (!isUuid(postId) || ids.length === 0) return;
    await this.prisma.postTag.createMany({ data: ids.map((userId) => ({ postId, userId, status: 'PENDING', createdAt: at })), skipDuplicates: true });
  }

  async tagsFor(postIds: string[]): Promise<PostTagRecord[]> {
    const ids = postIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.prisma.postTag.findMany({ where: { postId: { in: ids } } });
    return rows.map((r) => ({ postId: r.postId, userId: r.userId, status: r.status as PostTagStatus, createdAt: r.createdAt }));
  }

  async respondTag(postId: string, userId: string, status: PostTagStatus): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(userId)) return false;
    const result = await this.prisma.postTag.updateMany({ where: { postId, userId }, data: { status } });
    return result.count > 0;
  }

  async listPendingTags(userId: string, page: Page): Promise<PostWithImages[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.post.findMany({
      where: { tags: { some: { userId, status: 'PENDING' } }, archivedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit,
      include: PrismaPostRepository.include,
    });
    return rows.map(PrismaPostRepository.toView);
  }

  async delete(postId: string, authorId: string): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(authorId)) return false;
    const result = await this.prisma.post.deleteMany({ where: { id: postId, authorId } });
    return result.count > 0;
  }

  async update(postId: string, authorId: string, patch: PostPatch): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(authorId)) return false;
    const result = await this.prisma.post.updateMany({ where: { id: postId, authorId }, data: patch });
    return result.count > 0;
  }

  async setArchived(postId: string, authorId: string, at: Date | null): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(authorId)) return false;
    const result = await this.prisma.post.updateMany({ where: { id: postId, authorId }, data: { archivedAt: at } });
    return result.count > 0;
  }

  async listArchived(authorId: string, page: Page): Promise<PostWithImages[]> {
    if (!isUuid(authorId)) return [];
    const rows = await this.prisma.post.findMany({
      where: { authorId, archivedAt: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit,
      include: PrismaPostRepository.include,
    });
    return rows.map(PrismaPostRepository.toView);
  }

  async replaceImage(postId: string, imageId: string, newId: string, mime: string, data: Uint8Array): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(imageId) || !isUuid(newId)) return false;
    const result = await this.prisma.postImage.updateMany({ where: { id: imageId, postId, data: { not: null } }, data: { id: newId, mime, data: Buffer.from(data) } });
    return result.count > 0;
  }

  async hide(postId: string, userId: string): Promise<void> {
    if (!isUuid(postId) || !isUuid(userId)) return;
    await this.prisma.postHidden.createMany({ data: [{ postId, userId }], skipDuplicates: true });
  }

  async like(postId: string, userId: string, at: Date): Promise<void> {
    if (!isUuid(postId) || !isUuid(userId)) return;
    await this.prisma.postLike.createMany({ data: [{ postId, userId, createdAt: at }], skipDuplicates: true });
  }

  async unlike(postId: string, userId: string): Promise<void> {
    if (!isUuid(postId) || !isUuid(userId)) return;
    await this.prisma.postLike.deleteMany({ where: { postId, userId } });
  }

  async likeStats(postIds: string[], viewerId: string): Promise<{ postId: string; count: number; liked: boolean }[]> {
    const ids = postIds.filter(isUuid);
    if (ids.length === 0) return [];
    const [groups, mine] = await Promise.all([
      this.prisma.postLike.groupBy({ by: ['postId'], where: { postId: { in: ids } }, _count: { _all: true } }),
      isUuid(viewerId) ? this.prisma.postLike.findMany({ where: { postId: { in: ids }, userId: viewerId }, select: { postId: true } }) : Promise.resolve([]),
    ]);
    const counts = new Map(groups.map((g) => [g.postId, g._count._all]));
    const liked = new Set(mine.map((m) => m.postId));
    return ids.map((postId) => ({ postId, count: counts.get(postId) ?? 0, liked: liked.has(postId) }));
  }

  async listEngagement(userId: string, since: Date, limit: number): Promise<EngagementRow[]> {
    if (!isUuid(userId)) return [];
    const [likes, comments] = await Promise.all([
      this.prisma.postLike.findMany({ where: { userId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: limit }),
      this.prisma.postComment.findMany({ where: { authorId: userId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: limit }),
    ]);
    const rows: EngagementRow[] = [
      ...likes.map((l) => ({ postId: l.postId, kind: 'LIKE' as const, at: l.createdAt })),
      ...comments.map((c) => ({ postId: c.postId, kind: 'COMMENT' as const, at: c.createdAt })),
    ];
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  }

  async addComment(comment: PostCommentRecord): Promise<void> {
    await this.prisma.postComment.create({ data: { id: comment.id, postId: comment.postId, authorId: comment.authorId, body: comment.body, createdAt: comment.createdAt, venueId: comment.venueId ?? null } });
  }

  async findComment(id: string): Promise<PostCommentRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.postComment.findUnique({ where: { id } });
    return row ?? undefined;
  }

  async listComments(postId: string, page: Page): Promise<PostCommentRecord[]> {
    if (!isUuid(postId)) return [];
    return this.prisma.postComment.findMany({ where: { postId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: page.offset, take: page.limit });
  }

  async deleteComment(id: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.prisma.postComment.deleteMany({ where: { id } });
  }

  async likeComment(commentId: string, userId: string, at: Date): Promise<void> {
    if (!isUuid(commentId) || !isUuid(userId)) return;
    await this.prisma.postCommentLike.createMany({ data: [{ commentId, userId, createdAt: at }], skipDuplicates: true });
  }

  async unlikeComment(commentId: string, userId: string): Promise<void> {
    if (!isUuid(commentId) || !isUuid(userId)) return;
    await this.prisma.postCommentLike.deleteMany({ where: { commentId, userId } });
  }

  async commentLikeStats(commentIds: string[], viewerId: string): Promise<{ commentId: string; count: number; liked: boolean }[]> {
    const ids = commentIds.filter(isUuid);
    if (ids.length === 0) return [];
    const groups = await this.prisma.postCommentLike.groupBy({ by: ['commentId'], where: { commentId: { in: ids } }, _count: { _all: true } });
    const counts = new Map(groups.map((g) => [g.commentId, g._count._all]));
    const mine = isUuid(viewerId) ? await this.prisma.postCommentLike.findMany({ where: { commentId: { in: ids }, userId: viewerId }, select: { commentId: true } }) : [];
    const liked = new Set(mine.map((m) => m.commentId));
    return ids.map((commentId) => ({ commentId, count: counts.get(commentId) ?? 0, liked: liked.has(commentId) }));
  }

  async commentCounts(postIds: string[]): Promise<{ postId: string; count: number }[]> {
    const ids = postIds.filter(isUuid);
    if (ids.length === 0) return [];
    const groups = await this.prisma.postComment.groupBy({ by: ['postId'], where: { postId: { in: ids } }, _count: { _all: true } });
    const counts = new Map(groups.map((g) => [g.postId, g._count._all]));
    return ids.map((postId) => ({ postId, count: counts.get(postId) ?? 0 }));
  }

  async report(report: PostReportRecord): Promise<void> {
    await this.prisma.postReport.upsert({
      where: { postId_reporterId: { postId: report.postId, reporterId: report.reporterId } },
      create: { id: report.id, postId: report.postId, reporterId: report.reporterId, reason: report.reason, details: report.details, createdAt: report.createdAt },
      update: { reason: report.reason, details: report.details, resolvedAt: null, resolvedBy: null, resolution: null, resolutionNote: null },
    });
  }

  async attachVideo(postId: string, imageId: string, mime: string, data: Uint8Array): Promise<boolean> {
    if (!isUuid(postId) || !isUuid(imageId)) return false;
    const result = await this.prisma.postImage.updateMany({ where: { id: imageId, postId, data: { not: null } }, data: { videoMime: mime, videoData: Buffer.from(data) } });
    return result.count > 0;
  }

  async findVideo(imageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(imageId)) return undefined;
    const row = await this.prisma.postImage.findUnique({ where: { id: imageId }, select: { videoMime: true, videoData: true } });
    return row && row.videoMime && row.videoData ? { mime: row.videoMime, data: new Uint8Array(row.videoData) } : undefined;
  }

  async findImage(imageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(imageId)) return undefined;
    const row = await this.prisma.postImage.findUnique({ where: { id: imageId }, select: { mime: true, data: true } });
    return row && row.mime && row.data ? { mime: row.mime, data: new Uint8Array(row.data) } : undefined;
  }
}
