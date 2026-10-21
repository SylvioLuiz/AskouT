import type { PrismaClient } from '@prisma/client';
import type { RegionRepository } from '../../core/ports.ts';
import type { RegionRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

export class PrismaRegionRepository implements RegionRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async find(userId: string): Promise<RegionRecord | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.userRegion.findUnique({ where: { userId } });
    return row ? { userId: row.userId, lat: row.lat, lng: row.lng, updatedAt: row.updatedAt } : undefined;
  }

  async upsert(region: RegionRecord): Promise<void> {
    await this.prisma.userRegion.upsert({
      where: { userId: region.userId },
      create: { userId: region.userId, lat: region.lat, lng: region.lng, updatedAt: region.updatedAt },
      update: { lat: region.lat, lng: region.lng, updatedAt: region.updatedAt },
    });
  }

  async delete(userId: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    return (await this.prisma.userRegion.deleteMany({ where: { userId } })).count === 1;
  }

  async listInBox(box: { minLat: number; maxLat: number; minLng: number; maxLng: number }, limit: number): Promise<RegionRecord[]> {
    const rows = await this.prisma.userRegion.findMany({
      where: { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } },
      orderBy: { userId: 'asc' },
      take: limit,
    });
    return rows.map((r) => ({ userId: r.userId, lat: r.lat, lng: r.lng, updatedAt: r.updatedAt }));
  }
}
