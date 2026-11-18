import type { Prisma, PrismaClient } from '@prisma/client';
import type { BusyIntervalRecord, PersonalCalendarChoice, PersonalCalendarConnection, PersonalCalendarRepository, PersonalCalendarSource, UserBusyRecord } from '../../core/ports.ts';
import type { ExternalProvider } from '../../core/types.ts';
import { isUuid, onlyUuids } from './helpers.ts';

const SOURCES: readonly PersonalCalendarSource[] = ['GOOGLE', 'DEVICE', 'ICS'];

type Row = {
  id: string;
  userId: string;
  provider: string;
  status: PersonalCalendarConnection['status'];
  refreshTokenEnc: string | null;
  sourceEnc: string | null;
  label: string | null;
  accountEmail: string | null;
  calendars: Prisma.JsonValue | null;
  lastError: string | null;
  lastSyncAt: Date | null;
  createdAt: Date;
};

function choices(value: Prisma.JsonValue | null): PersonalCalendarChoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (typeof c['id'] !== 'string') return [];
    return [{ id: c['id'], name: typeof c['name'] === 'string' ? c['name'] : c['id'], selected: c['selected'] === true, color: typeof c['color'] === 'string' ? c['color'] : null, account: typeof c['account'] === 'string' ? c['account'] : null }];
  });
}

function toRecord(r: Row): PersonalCalendarConnection {
  return {
    id: r.id,
    userId: r.userId,
    provider: r.provider as PersonalCalendarSource,
    status: r.status,
    label: r.label,
    accountEmail: r.accountEmail,
    refreshTokenSealed: r.refreshTokenEnc,
    sourceSealed: r.sourceEnc,
    calendars: choices(r.calendars),
    lastSyncAt: r.lastSyncAt,
    lastError: r.lastError,
    createdAt: r.createdAt,
  };
}

/** Agendas pessoais ligadas (tabela CalendarConnection, só os tipos GOOGLE, DEVICE e ICS) e seus horários ocupados. */
export class PrismaPersonalCalendarRepository implements PersonalCalendarRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async list(userId: string): Promise<PersonalCalendarConnection[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.calendarConnection.findMany({ where: { userId, provider: { in: [...SOURCES] } }, orderBy: { createdAt: 'asc' } });
    return rows.map(toRecord);
  }

  async find(id: string): Promise<PersonalCalendarConnection | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.calendarConnection.findUnique({ where: { id } });
    return row && SOURCES.includes(row.provider as PersonalCalendarSource) ? toRecord(row) : undefined;
  }

  async save(c: PersonalCalendarConnection): Promise<void> {
    const data = {
      status: c.status,
      label: c.label,
      accountEmail: c.accountEmail,
      refreshTokenEnc: c.refreshTokenSealed,
      sourceEnc: c.sourceSealed,
      calendars: c.calendars as unknown as Prisma.InputJsonValue,
      lastSyncAt: c.lastSyncAt,
      lastError: c.lastError,
    };
    await this.prisma.calendarConnection.upsert({
      where: { id: c.id },
      create: { id: c.id, userId: c.userId, provider: c.provider, createdAt: c.createdAt, ...data },
      update: data,
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    if (!isUuid(id) || !isUuid(userId)) return false;
    const r = await this.prisma.calendarConnection.deleteMany({ where: { id, userId, provider: { in: [...SOURCES] } } });
    return r.count > 0;
  }

  async replaceBusy(connectionId: string, intervals: BusyIntervalRecord[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.calendarBusyInterval.deleteMany({ where: { connectionId } }),
      this.prisma.calendarBusyInterval.createMany({ data: intervals.map((i) => ({ connectionId, startsAt: i.start, endsAt: i.end })) }),
    ]);
  }

  async listBusy(userIds: string[], from: Date, to: Date): Promise<UserBusyRecord[]> {
    const ids = onlyUuids(userIds);
    if (ids.length === 0) return [];
    const rows = await this.prisma.calendarBusyInterval.findMany({
      where: { startsAt: { lt: to }, endsAt: { gt: from }, connection: { userId: { in: ids }, status: 'ACTIVE', provider: { in: [...SOURCES] } } },
      orderBy: { startsAt: 'asc' },
      take: 5000,
      select: { startsAt: true, endsAt: true, connection: { select: { id: true, userId: true, provider: true, label: true } } },
    });
    return rows.map((r) => ({ start: r.startsAt, end: r.endsAt, userId: r.connection.userId, connectionId: r.connection.id, provider: r.connection.provider as PersonalCalendarSource, label: r.connection.label }));
  }

  async listDue(before: Date, limit: number): Promise<PersonalCalendarConnection[]> {
    const rows = await this.prisma.calendarConnection.findMany({
      where: { status: 'ACTIVE', provider: { in: ['GOOGLE', 'ICS'] }, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: before } }] },
      orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async loginProvidersOf(userId: string): Promise<ExternalProvider[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.externalIdentity.findMany({ where: { userId }, select: { provider: true } });
    return [...new Set(rows.map((r) => r.provider as ExternalProvider))];
  }
}
