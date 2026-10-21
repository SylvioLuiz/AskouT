import type { PrismaClient } from '@prisma/client';
import type { Boost } from '@prisma/client';
import type { BoostRepository } from '../../core/ports.ts';
import type { BoostChannel, BoostRecord, BoostStatus, BoostTarget } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

function toRecord(row: Boost): BoostRecord {
  return {
    id: row.id,
    venueId: row.venueId,
    ownerId: row.ownerId,
    channel: row.channel === 'APPLE' || row.channel === 'GOOGLE' ? (row.channel as BoostChannel) : 'WEB',
    target: row.target as BoostTarget,
    eventId: row.eventId,
    days: row.days,
    amountCents: row.amountCents,
    status: row.status as BoostStatus,
    chargeId: row.chargeId,
    payCode: row.payCode,
    payUrl: row.payUrl,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    audience: row.audience === 'MATCH' ? 'MATCH' : 'ALL',
    radiusM: row.radiusM,
    matchTags: row.matchTags,
  };
}

export class PrismaBoostRepository implements BoostRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(boost: BoostRecord): Promise<void> {
    await this.prisma.boost.create({ data: { ...boost } });
  }

  async find(id: string): Promise<BoostRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.boost.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }

  async findByChargeId(chargeId: string): Promise<BoostRecord | undefined> {
    const row = await this.prisma.boost.findUnique({ where: { chargeId } });
    return row ? toRecord(row) : undefined;
  }

  async listByVenue(venueId: string): Promise<BoostRecord[]> {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.boost.findMany({ where: { venueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(toRecord);
  }

  async markPaid(id: string, paid: { paidAt: Date; startsAt: Date; endsAt: Date; chargeId?: string }): Promise<boolean> {
    if (!isUuid(id)) return false;
    try {
      // O filtro por estado faz a confirmação valer uma única vez, mesmo com avisos repetidos ao mesmo tempo.
      const result = await this.prisma.boost.updateMany({
        where: { id, status: 'PENDING_PAYMENT' },
        data: { status: 'PAID', paidAt: paid.paidAt, startsAt: paid.startsAt, endsAt: paid.endsAt, payCode: null, payUrl: null, ...(paid.chargeId === undefined ? {} : { chargeId: paid.chargeId }) },
      });
      return result.count === 1;
    } catch (failure) {
      // chargeId é único: o mesmo recibo da loja não paga um segundo pedido.
      if (paid.chargeId !== undefined && (failure as { code?: unknown }).code === 'P2002') return false;
      throw failure;
    }
  }

  async transition(id: string, from: BoostStatus[], to: BoostStatus): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.boost.updateMany({ where: { id, status: { in: from } }, data: { status: to } });
    return result.count === 1;
  }

  async listActive(now: Date): Promise<BoostRecord[]> {
    const rows = await this.prisma.boost.findMany({ where: { status: 'PAID', startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { id: 'asc' } });
    return rows.map(toRecord);
  }
}
