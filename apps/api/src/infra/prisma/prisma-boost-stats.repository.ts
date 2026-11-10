import type { PrismaClient } from '@prisma/client';
import type { BoostStatsRepository } from '../../core/ports.ts';
import type { BoostPlacement, BoostStatKind, BoostStatRow } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

export class PrismaBoostStatsRepository implements BoostStatsRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async countOnce(entry: { boostId: string; day: string; kind: BoostStatKind; placement: BoostPlacement; viewerKey: string }): Promise<boolean> {
    if (!isUuid(entry.boostId)) return false;
    // A marcação é única pela chave primária: dois envios ao mesmo tempo contam uma vez só.
    const { count } = await this.prisma.boostSeen.createMany({
      data: [{ boostId: entry.boostId, day: entry.day, kind: entry.kind, viewerKey: entry.viewerKey }],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    // ON CONFLICT soma no banco, sem corrida entre ler e gravar.
    await this.prisma.$executeRaw`
      INSERT INTO "BoostDailyStat" ("boostId", "day", "placement", "kind", "count")
      VALUES (${entry.boostId}::uuid, ${entry.day}, ${entry.placement}, ${entry.kind}, 1)
      ON CONFLICT ("boostId", "day", "placement", "kind") DO UPDATE SET "count" = "BoostDailyStat"."count" + 1`;
    return true;
  }

  async wasCounted(entry: { boostId: string; day: string; kind: BoostStatKind; viewerKey: string }): Promise<boolean> {
    if (!isUuid(entry.boostId)) return false;
    const row = await this.prisma.boostSeen.findUnique({
      where: { boostId_day_kind_viewerKey: { boostId: entry.boostId, day: entry.day, kind: entry.kind, viewerKey: entry.viewerKey } },
      select: { boostId: true },
    });
    return row !== null;
  }

  async listByBoost(boostId: string): Promise<BoostStatRow[]> {
    if (!isUuid(boostId)) return [];
    const rows = await this.prisma.boostDailyStat.findMany({ where: { boostId }, orderBy: [{ day: 'asc' }, { placement: 'asc' }, { kind: 'asc' }] });
    return rows.map((r) => ({ boostId: r.boostId, day: r.day, placement: r.placement as BoostPlacement, kind: r.kind as BoostStatKind, count: r.count }));
  }

  async purgeSeenBefore(day: string): Promise<number> {
    return (await this.prisma.boostSeen.deleteMany({ where: { day: { lt: day } } })).count;
  }
}
