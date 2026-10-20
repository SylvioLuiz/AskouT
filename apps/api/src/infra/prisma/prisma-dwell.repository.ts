import type { PrismaClient } from '@prisma/client';
import type { DwellRepository } from '../../core/ports.ts';
import type { DwellRecord, DwellSource, DwellTarget } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

export class PrismaDwellRepository implements DwellRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async addMany(records: DwellRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.prisma.contentDwell.createMany({ data: records.map((r) => ({ ...r })) });
  }

  async listByUser(userId: string, since: Date, limit: number): Promise<DwellRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.contentDwell.findMany({ where: { userId, createdAt: { gte: since } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map((r) => ({ id: r.id, userId: r.userId, targetType: r.targetType as DwellTarget, targetId: r.targetId, ms: r.ms, source: r.source as DwellSource, createdAt: r.createdAt }));
  }

  async deleteByUser(userId: string): Promise<number> {
    if (!isUuid(userId)) return 0;
    return (await this.prisma.contentDwell.deleteMany({ where: { userId } })).count;
  }

  async deleteOlderThan(userId: string, before: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return (await this.prisma.contentDwell.deleteMany({ where: { userId, createdAt: { lt: before } } })).count;
  }
}
