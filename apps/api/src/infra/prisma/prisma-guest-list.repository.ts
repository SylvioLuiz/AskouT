import type { PrismaClient } from '@prisma/client';
import type { GuestListRepository } from '../../core/ports.ts';
import type { GuestListEntryRecord, GuestListRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

export class PrismaGuestListRepository implements GuestListRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async get(eventId: string): Promise<GuestListRecord | undefined> {
    if (!isUuid(eventId)) return undefined;
    const row = await this.prisma.guestList.findUnique({ where: { eventId } });
    return row ?? undefined;
  }

  async upsert(list: GuestListRecord): Promise<boolean> {
    if (!isUuid(list.eventId)) return false;
    if (!(await this.prisma.placeEvent.findUnique({ where: { id: list.eventId }, select: { id: true } }))) return false;
    const data = { limit: list.limit, closesAt: list.closesAt, maxCompanions: list.maxCompanions };
    await this.prisma.guestList.upsert({ where: { eventId: list.eventId }, create: { eventId: list.eventId, createdAt: list.createdAt, ...data }, update: data });
    return true;
  }

  async remove(eventId: string): Promise<boolean> {
    if (!isUuid(eventId)) return false;
    const result = await this.prisma.guestList.deleteMany({ where: { eventId } });
    return result.count > 0;
  }

  async join(entry: { eventId: string; userId: string; companions: number; at: Date }, limit: number | null): Promise<'created' | 'updated' | 'full'> {
    const { eventId, userId, companions, at } = entry;
    return this.prisma.$transaction(async (tx) => {
      // Trava a lista: dois pedidos ao mesmo tempo não passam do limite.
      await tx.$queryRaw`SELECT "eventId" FROM "GuestList" WHERE "eventId" = ${eventId}::uuid FOR UPDATE`;
      const before = await tx.guestListEntry.findUnique({ where: { eventId_userId: { eventId, userId } } });
      if (before) {
        await tx.guestListEntry.update({ where: { eventId_userId: { eventId, userId } }, data: { companions } });
        return 'updated' as const;
      }
      if (limit !== null && (await tx.guestListEntry.count({ where: { eventId } })) >= limit) return 'full' as const;
      await tx.guestListEntry.create({ data: { eventId, userId, companions, createdAt: at } });
      return 'created' as const;
    });
  }

  async leave(eventId: string, userId: string): Promise<boolean> {
    if (!isUuid(eventId) || !isUuid(userId)) return false;
    const result = await this.prisma.guestListEntry.deleteMany({ where: { eventId, userId } });
    return result.count > 0;
  }

  async find(eventId: string, userId: string): Promise<GuestListEntryRecord | undefined> {
    if (!isUuid(eventId) || !isUuid(userId)) return undefined;
    const row = await this.prisma.guestListEntry.findUnique({ where: { eventId_userId: { eventId, userId } } });
    return row ?? undefined;
  }

  async list(eventId: string): Promise<GuestListEntryRecord[]> {
    if (!isUuid(eventId)) return [];
    return this.prisma.guestListEntry.findMany({ where: { eventId }, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] });
  }

  async count(eventId: string): Promise<number> {
    if (!isUuid(eventId)) return 0;
    return this.prisma.guestListEntry.count({ where: { eventId } });
  }

  async setCheckedIn(eventId: string, userId: string, at: Date | null): Promise<boolean> {
    if (!isUuid(eventId) || !isUuid(userId)) return false;
    const result = await this.prisma.guestListEntry.updateMany({ where: { eventId, userId }, data: { checkedInAt: at } });
    return result.count > 0;
  }
}
