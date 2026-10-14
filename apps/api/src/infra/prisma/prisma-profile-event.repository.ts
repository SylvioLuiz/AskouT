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

  async list(userId: string, page: Page): Promise<{ eventId: string; createdAt: Date }[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.postedEvent.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { eventId: 'desc' }], skip: page.offset, take: page.limit });
    return rows.map((r) => ({ eventId: r.eventId, createdAt: r.createdAt }));
  }

  async count(userId: string): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.postedEvent.count({ where: { userId } });
  }
}
