import type { Prisma, PrismaClient } from '@prisma/client';
import { conflict } from '../../core/errors.ts';
import type { AvailabilityRepository } from '../../core/ports.ts';
import type { AvailabilitySlotRecord } from '../../core/types.ts';
import { isUuid, onlyUuids } from './helpers.ts';

function toRecord(row: {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  state: AvailabilitySlotRecord['state'];
  createdAt: Date;
}): AvailabilitySlotRecord {
  return { id: row.id, userId: row.userId, startsAt: row.startsAt, endsAt: row.endsAt, state: row.state, createdAt: row.createdAt };
}

const OVERLAP = 'Você já tem um horário neste período. Remova o outro antes.';

export class PrismaAvailabilityRepository implements AvailabilityRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async add(slot: AvailabilitySlotRecord): Promise<void> {
    // Verificar e inserir na mesma transação SERIALIZABLE: duas requisições simultâneas que se sobreponham
    // não passam as duas (a segunda falha com P2034 e vira CONFLICT).
    try {
      await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const clash = await tx.availabilitySlot.findFirst({
            where: { userId: slot.userId, startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
            select: { id: true },
          });
          if (clash) throw conflict(OVERLAP);
          await tx.availabilitySlot.create({
            data: {
              id: slot.id,
              userId: slot.userId,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              state: slot.state,
              createdAt: slot.createdAt,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2034') {
        throw conflict(OVERLAP);
      }
      throw error;
    }
  }

  async delete(userId: string, slotId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(slotId)) return false;
    const result = await this.prisma.availabilitySlot.deleteMany({ where: { id: slotId, userId } });
    return result.count > 0;
  }

  async listForUsers(userIds: string[], from: Date, to: Date): Promise<AvailabilitySlotRecord[]> {
    const valid = onlyUuids(userIds);
    if (valid.length === 0) return [];
    const rows = await this.prisma.availabilitySlot.findMany({
      where: { userId: { in: valid }, startsAt: { lt: to }, endsAt: { gt: from } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return (rows as Parameters<typeof toRecord>[0][]).map(toRecord);
  }

  async countActive(userId: string, since: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.availabilitySlot.count({ where: { userId, endsAt: { gt: since } } });
  }
}
