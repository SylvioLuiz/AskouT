import type { PrismaClient } from '@prisma/client';
import type { AlbumPhotoMeta, AlbumPhotoRecord, AlbumRecord } from '../../core/album.ts';
import type { AlbumRepository } from '../../core/ports.ts';
import { isUuid } from './helpers.ts';

type AlbumRow = { id: string; kind: string; refId: string; title: string | null; placeName: string | null; startedAt: Date; createdAt: Date };

const toRecord = (r: AlbumRow): AlbumRecord => ({ id: r.id, kind: r.kind as AlbumRecord['kind'], refId: r.refId, title: r.title, placeName: r.placeName, startedAt: r.startedAt, createdAt: r.createdAt });

export class PrismaAlbumRepository implements AlbumRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async ensure(album: AlbumRecord): Promise<AlbumRecord> {
    // skipDuplicates: duas instâncias abrindo o mesmo álbum juntas acabam com uma linha só.
    await this.prisma.album.createMany({
      data: [{ id: album.id, kind: album.kind, refId: album.refId, title: album.title, placeName: album.placeName, startedAt: album.startedAt, createdAt: album.createdAt }],
      skipDuplicates: true,
    });
    const row = await this.prisma.album.findUniqueOrThrow({ where: { kind_refId: { kind: album.kind, refId: album.refId } } });
    return toRecord(row);
  }

  async find(id: string): Promise<AlbumRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.album.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }

  async addMembers(albumId: string, userIds: string[], at: Date): Promise<void> {
    if (!isUuid(albumId)) return;
    const ids = [...new Set(userIds)].filter(isUuid);
    if (ids.length === 0) return;
    await this.prisma.albumMember.createMany({ data: ids.map((userId) => ({ albumId, userId, joinedAt: at })), skipDuplicates: true });
  }

  async listMembers(albumId: string): Promise<string[]> {
    if (!isUuid(albumId)) return [];
    const rows = await this.prisma.albumMember.findMany({ where: { albumId }, orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }], select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async isMember(albumId: string, userId: string): Promise<boolean> {
    if (!isUuid(albumId) || !isUuid(userId)) return false;
    return (await this.prisma.albumMember.count({ where: { albumId, userId } })) > 0;
  }

  async listForUser(userId: string, since: Date, limit: number): Promise<AlbumRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.album.findMany({ where: { startedAt: { gt: since }, members: { some: { userId } } }, orderBy: [{ startedAt: 'desc' }, { id: 'asc' }], take: limit });
    return rows.map(toRecord);
  }

  async listStartedBetween(from: Date, to: Date, limit: number): Promise<AlbumRecord[]> {
    const rows = await this.prisma.album.findMany({ where: { startedAt: { gt: from, lte: to } }, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], take: limit });
    return rows.map(toRecord);
  }

  async addPhoto(photo: AlbumPhotoRecord): Promise<void> {
    await this.prisma.albumPhoto.create({ data: { id: photo.id, albumId: photo.albumId, authorId: photo.authorId, mime: photo.mime, data: Buffer.from(photo.data), createdAt: photo.createdAt } });
  }

  async listPhotos(albumId: string): Promise<AlbumPhotoMeta[]> {
    if (!isUuid(albumId)) return [];
    return this.prisma.albumPhoto.findMany({ where: { albumId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, albumId: true, authorId: true, createdAt: true } });
  }

  async countPhotos(albumId: string, authorId?: string): Promise<number> {
    if (!isUuid(albumId) || (authorId !== undefined && !isUuid(authorId))) return 0;
    return this.prisma.albumPhoto.count({ where: { albumId, ...(authorId === undefined ? {} : { authorId }) } });
  }

  async findPhoto(albumId: string, photoId: string): Promise<AlbumPhotoRecord | undefined> {
    if (!isUuid(albumId) || !isUuid(photoId)) return undefined;
    const row = await this.prisma.albumPhoto.findFirst({ where: { id: photoId, albumId } });
    return row ? { id: row.id, albumId: row.albumId, authorId: row.authorId, mime: row.mime, data: new Uint8Array(row.data), createdAt: row.createdAt } : undefined;
  }

  async deletePhoto(albumId: string, photoId: string, authorId: string): Promise<boolean> {
    if (!isUuid(albumId) || !isUuid(photoId) || !isUuid(authorId)) return false;
    return (await this.prisma.albumPhoto.deleteMany({ where: { id: photoId, albumId, authorId } })).count > 0;
  }

  async markSummarized(albumId: string, userId: string, at: Date): Promise<boolean> {
    if (!isUuid(albumId) || !isUuid(userId)) return false;
    // Só uma instância consegue virar a linha de "nunca avisado" para "avisado".
    return (await this.prisma.albumMember.updateMany({ where: { albumId, userId, summarizedAt: null }, data: { summarizedAt: at } })).count > 0;
  }
}
