import type { PrismaClient } from '@prisma/client';
import type { ConsentRepository } from '../../core/ports.ts';
import type { ConsentEventRecord, ConsentPurpose, ConsentSource } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

/** Histórico de consentimentos opcionais. Só cresce; some junto com a conta (ON DELETE CASCADE). */
export class PrismaConsentRepository implements ConsentRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async add(event: ConsentEventRecord): Promise<void> {
    await this.prisma.consentEvent.create({ data: { id: event.id, userId: event.userId, purpose: event.purpose, granted: event.granted, source: event.source, at: event.at } });
  }

  async listByUser(userId: string, limit: number): Promise<ConsentEventRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.consentEvent.findMany({ where: { userId }, orderBy: [{ at: 'desc' }, { seq: 'desc' }], take: limit });
    return rows.map((r) => ({ id: r.id, userId: r.userId, purpose: r.purpose as ConsentPurpose, granted: r.granted, source: r.source as ConsentSource, at: r.at }));
  }
}
