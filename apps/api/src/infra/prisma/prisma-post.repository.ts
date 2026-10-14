import type { PrismaClient } from '@prisma/client';
import type { PostRepository } from '../../core/ports.ts';
import type { Page, PostImageRecord, PostRecord, PostTagRecord, PostTagStatus, PostWithImages } from '../../core/types.ts';
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
        createdAt: post.createdAt,
        images: {
          create: images.map((i) => ({
            id: i.id,
            position: i.position,
            mime: i.mime,
            data: i.data ? Buffer.from(i.data) : null,
            placePhotoRef: i.placePhotoRef,
            placePhotoAuthor: i.placePhotoAuthor,
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
    createdAt: Date;
    images: { id: string; position: number; mime: string | null; placePhotoRef: string | null; placePhotoAuthor: string | null }[];
  }): PostWithImages {
    return {
      post: { id: row.id, authorId: row.authorId, caption: row.caption, placeName: row.placeName, placeAddress: row.placeAddress, createdAt: row.createdAt },
      images: row.images.map((i) => ({ id: i.id, position: i.position, isUpload: i.mime !== null, placePhotoRef: i.placePhotoRef, placePhotoAuthor: i.placePhotoAuthor })),
    };
  }

  // Não traz os bytes das fotos: só os campos de metadados.
  private static readonly include = {
    images: { select: { id: true, position: true, mime: true, placePhotoRef: true, placePhotoAuthor: true }, orderBy: { position: 'asc' as const } },
  };

  async findById(id: string): Promise<PostWithImages | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.post.findUnique({ where: { id }, include: PrismaPostRepository.include });
    return row ? PrismaPostRepository.toView(row) : undefined;
  }

  private static viaTag(taggedIds: string[]) {
    return { tags: { some: { userId: { in: taggedIds }, status: 'ACCEPTED' } } };
  }

  async listFor(authorIds: string[], taggedIds: string[], page: Page): Promise<PostWithImages[]> {
    const authors = authorIds.filter(isUuid);
    const tagged = taggedIds.filter(isUuid);
    const or = [...(authors.length > 0 ? [{ authorId: { in: authors } }] : []), ...(tagged.length > 0 ? [PrismaPostRepository.viaTag(tagged)] : [])];
    if (or.length === 0) return [];
    const rows = await this.prisma.post.findMany({
      where: { OR: or },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: page.offset,
      take: page.limit,
      include: PrismaPostRepository.include,
    });
    return rows.map(PrismaPostRepository.toView);
  }

  async countFor(userId: string): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.post.count({ where: { OR: [{ authorId: userId }, PrismaPostRepository.viaTag([userId])] } });
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
      where: { tags: { some: { userId, status: 'PENDING' } } },
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

  async findImage(imageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(imageId)) return undefined;
    const row = await this.prisma.postImage.findUnique({ where: { id: imageId }, select: { mime: true, data: true } });
    return row && row.mime && row.data ? { mime: row.mime, data: new Uint8Array(row.data) } : undefined;
  }
}
