import type { PrismaClient } from '@prisma/client';
import type { CloakroomRepository } from '../../core/ports.ts';
import type { CloakroomSettingRecord, CloakroomStatus, CloakroomTicketRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

type TicketRow = {
  id: string;
  placeEventId: string;
  userId: string;
  number: number;
  code: string;
  description: string;
  itemCount: number;
  status: string;
  createdAt: Date;
  storedAt: Date | null;
  returnedAt: Date | null;
};

function toTicket(r: TicketRow): CloakroomTicketRecord {
  return { id: r.id, placeEventId: r.placeEventId, userId: r.userId, number: r.number, code: r.code, description: r.description, itemCount: r.itemCount, status: r.status as CloakroomStatus, createdAt: r.createdAt, storedAt: r.storedAt, returnedAt: r.returnedAt };
}

/** Chapelaria do evento. Some junto com o evento ou com a conta (ON DELETE CASCADE). */
export class PrismaCloakroomRepository implements CloakroomRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findSetting(placeEventId: string): Promise<CloakroomSettingRecord | undefined> {
    if (!isUuid(placeEventId)) return undefined;
    const r = await this.prisma.cloakroomSetting.findUnique({ where: { placeEventId } });
    return r ? { placeEventId: r.placeEventId, enabled: r.enabled, priceCents: r.priceCents, capacity: r.capacity, note: r.note } : undefined;
  }

  async saveSetting(s: CloakroomSettingRecord): Promise<void> {
    const data = { enabled: s.enabled, priceCents: s.priceCents, capacity: s.capacity, note: s.note };
    await this.prisma.cloakroomSetting.upsert({ where: { placeEventId: s.placeEventId }, create: { placeEventId: s.placeEventId, ...data }, update: data });
  }

  /** O número é o próximo do evento; duas pessoas pedindo juntas tentam de novo se esbarrarem na chave única. */
  async createTicket(ticket: Omit<CloakroomTicketRecord, 'number'>): Promise<CloakroomTicketRecord> {
    for (let attempt = 0; ; attempt += 1) {
      const last = await this.prisma.cloakroomTicket.aggregate({ where: { placeEventId: ticket.placeEventId }, _max: { number: true } });
      try {
        const row = await this.prisma.cloakroomTicket.create({ data: { ...ticket, number: (last._max.number ?? 0) + 1 } });
        return toTicket(row);
      } catch (error) {
        if (attempt >= 4 || (error as { code?: string }).code !== 'P2002') throw error;
      }
    }
  }

  async findTicket(id: string): Promise<CloakroomTicketRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.cloakroomTicket.findUnique({ where: { id } });
    return r ? toTicket(r) : undefined;
  }

  async findTicketByCode(placeEventId: string, code: string): Promise<CloakroomTicketRecord | undefined> {
    if (!isUuid(placeEventId)) return undefined;
    const r = await this.prisma.cloakroomTicket.findUnique({ where: { placeEventId_code: { placeEventId, code } } });
    return r ? toTicket(r) : undefined;
  }

  async updateTicket(t: CloakroomTicketRecord): Promise<void> {
    await this.prisma.cloakroomTicket.update({ where: { id: t.id }, data: { status: t.status, storedAt: t.storedAt, returnedAt: t.returnedAt } });
  }

  async listByEvent(placeEventId: string): Promise<CloakroomTicketRecord[]> {
    if (!isUuid(placeEventId)) return [];
    const rows = await this.prisma.cloakroomTicket.findMany({ where: { placeEventId }, orderBy: { number: 'desc' } });
    return rows.map(toTicket);
  }

  async listByUser(userId: string, placeEventId?: string): Promise<CloakroomTicketRecord[]> {
    if (!isUuid(userId) || (placeEventId !== undefined && !isUuid(placeEventId))) return [];
    const rows = await this.prisma.cloakroomTicket.findMany({ where: { userId, ...(placeEventId === undefined ? {} : { placeEventId }) }, orderBy: [{ createdAt: 'desc' }, { number: 'desc' }] });
    return rows.map(toTicket);
  }
}
