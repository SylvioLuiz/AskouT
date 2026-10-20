import type { PrismaClient } from '@prisma/client';
import type { DwellRepository } from '../../core/ports.ts';
import type { DwellRecord, DwellSource, DwellTarget } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

type Row = { id: string; userId: string; targetType: string; targetId: string; ms: number; source: string; clicked: boolean; createdAt: Date };
const toRecord = (r: Row): DwellRecord => ({ id: r.id, userId: r.userId, targetType: r.targetType as DwellTarget, targetId: r.targetId, ms: r.ms, source: r.source as DwellSource, clicked: r.clicked, createdAt: r.createdAt });

export class PrismaDwellRepository implements DwellRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async addMany(records: DwellRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.prisma.contentDwell.createMany({ data: records.map((r) => ({ ...r, clicked: r.clicked === true })) });
  }

  async listByUser(userId: string, since: Date, limit: number): Promise<DwellRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.contentDwell.findMany({ where: { userId, createdAt: { gte: since } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(toRecord);
  }

  async listAllSince(since: Date, limit: number): Promise<DwellRecord[]> {
    const rows = await this.prisma.contentDwell.findMany({ where: { createdAt: { gte: since } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(toRecord);
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
