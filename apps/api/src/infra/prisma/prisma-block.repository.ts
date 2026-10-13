import type { PrismaClient } from '@prisma/client';
import type { BlockRepository } from '../../core/ports.ts';
import { isUuid } from './helpers.ts';

export class PrismaBlockRepository implements BlockRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async add(blockerId: string, blockedId: string, createdAt: Date): Promise<void> {
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId, createdAt },
      update: {},
    });
  }

  async remove(blockerId: string, blockedId: string): Promise<boolean> {
    if (!isUuid(blockerId) || !isUuid(blockedId)) return false;
    const result = await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    return result.count > 0;
  }

  async exists(blockerId: string, blockedId: string): Promise<boolean> {
    if (!isUuid(blockerId) || !isUuid(blockedId)) return false;
    const row = await this.prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      select: { blockerId: true },
    });
    return row !== null;
  }

  async existsEitherWay(a: string, b: string): Promise<boolean> {
    if (!isUuid(a) || !isUuid(b)) return false;
    const count = await this.prisma.block.count({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    return count > 0;
  }

  async listBlockedBy(blockerId: string): Promise<string[]> {
    if (!isUuid(blockerId)) return [];
    const rows = await this.prisma.block.findMany({ where: { blockerId }, select: { blockedId: true } });
    return rows.map((r: { blockedId: string }) => r.blockedId);
  }

  async listRelatedIds(userId: string): Promise<string[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    });
    const related = new Set<string>();
    for (const r of rows as { blockerId: string; blockedId: string }[]) related.add(r.blockerId === userId ? r.blockedId : r.blockerId);
    return [...related];
  }
}
