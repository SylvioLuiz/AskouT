import type { PrismaClient } from '@prisma/client';
import type { ProfileEventRepository } from '../../core/ports.ts';
import type { Page } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

export class PrismaProfileEventRepository implements ProfileEventRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async add(userId: string, eventId: string, at: Date): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(eventId)) return false;
    const result = await this.prisma.postedEvent.createMany({ data: [{ userId, eventId, createdAt: at }], skipDuplicates: true });
    return result.count > 0;
  }

  async remove(userId: string, eventId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(eventId)) return false;
    const result = await this.prisma.postedEvent.deleteMany({ where: { userId, eventId } });
    return result.count > 0;
  }

  async has(userId: string, eventId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(eventId)) return false;
    return (await this.prisma.postedEvent.count({ where: { userId, eventId } })) > 0;
  }

  async addPost(userId: string, postId: string, at: Date): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(postId)) return false;
    const result = await this.prisma.postedUserEvent.createMany({ data: [{ userId, postId, createdAt: at }], skipDuplicates: true });
    return result.count > 0;
  }

  async removePost(userId: string, postId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(postId)) return false;
    const result = await this.prisma.postedUserEvent.deleteMany({ where: { userId, postId } });
    return result.count > 0;
  }

  async hasPost(userId: string, postId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(postId)) return false;
    return (await this.prisma.postedUserEvent.count({ where: { userId, postId } })) > 0;
  }

  /** Une eventos de local e de pessoas, do mais recente ao mais antigo. Cada lado é limitado a 200 por perfil. */
  async list(userId: string, page: Page): Promise<{ eventId: string; postId?: string; createdAt: Date }[]> {
    if (!isUuid(userId)) return [];
    const take = page.offset + page.limit;
    const [places, people] = await Promise.all([
      this.prisma.postedEvent.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { eventId: 'desc' }], take }),
      this.prisma.postedUserEvent.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }], take }),
    ]);
    const merged = [...places.map((r) => ({ eventId: r.eventId, createdAt: r.createdAt })), ...people.map((r) => ({ eventId: r.postId, postId: r.postId, createdAt: r.createdAt }))];
    return merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.eventId < b.eventId ? 1 : -1)).slice(page.offset, page.offset + page.limit);
  }

  async count(userId: string): Promise<number> {
    if (!isUuid(userId)) return 0;
    const [a, b] = await Promise.all([this.prisma.postedEvent.count({ where: { userId } }), this.prisma.postedUserEvent.count({ where: { userId } })]);
    return a + b;
  }
}
