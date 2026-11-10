import type { PrismaClient, VenueOffer } from '@prisma/client';
import { conflict } from '../../core/errors.ts';
import type { OfferRepository } from '../../core/ports.ts';
import type { VenueOfferRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

function toRecord(row: VenueOffer): VenueOfferRecord {
  return { id: row.id, venueId: row.venueId, ownerId: row.ownerId, text: row.text, createdAt: row.createdAt, startsAt: row.startsAt, endsAt: row.endsAt, endedAt: row.endedAt };
}

export class PrismaOfferRepository implements OfferRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(offer: VenueOfferRecord, now: Date): Promise<void> {
    try {
      // O índice único parcial só deixa uma linha "aberta" por local: a que venceu sozinha é fechada antes de inserir.
      await this.prisma.$transaction([
        this.prisma.$executeRaw`UPDATE "VenueOffer" SET "endedAt" = "endsAt" WHERE "venueId" = ${offer.venueId}::uuid AND "endedAt" IS NULL AND "endsAt" <= ${now}`,
        this.prisma.venueOffer.create({ data: { ...offer } }),
      ]);
    } catch (failure) {
      if ((failure as { code?: unknown }).code === 'P2002') throw conflict('Este local já tem uma oferta no ar.');
      throw failure;
    }
  }

  async find(id: string): Promise<VenueOfferRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.venueOffer.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }

  async listByVenue(venueId: string, limit: number): Promise<VenueOfferRecord[]> {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.venueOffer.findMany({ where: { venueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(toRecord);
  }

  async findActiveByVenue(venueId: string, now: Date): Promise<VenueOfferRecord | undefined> {
    if (!isUuid(venueId)) return undefined;
    const row = await this.prisma.venueOffer.findFirst({ where: { venueId, endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } } });
    return row ? toRecord(row) : undefined;
  }

  async countSince(venueId: string, since: Date): Promise<number> {
    if (!isUuid(venueId)) return 0;
    return this.prisma.venueOffer.count({ where: { venueId, createdAt: { gte: since } } });
  }

  async end(id: string, now: Date): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.venueOffer.updateMany({ where: { id, endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, data: { endedAt: now } });
    return result.count === 1;
  }

  async listActive(now: Date): Promise<VenueOfferRecord[]> {
    const rows = await this.prisma.venueOffer.findMany({ where: { endedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { id: 'asc' } });
    return rows.map(toRecord);
  }
}
