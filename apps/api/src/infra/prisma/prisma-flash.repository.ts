import type { Prisma, PrismaClient } from '@prisma/client';
import { conflict } from '../../core/errors.ts';
import type { FlashRepository } from '../../core/ports.ts';
import type { FlashHiddenRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord } from '../../core/types.ts';
import { isUuid, onlyUuids } from './helpers.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN: FlashInviteRecord['status'][] = ['PENDING', 'ACCEPTED'];

type SessionRow = { id: string; userId: string; startsAt: Date; expiresAt: Date; endedAt: Date | null; note: string | null };
type InviteRow = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FlashInviteRecord['status'];
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  endedAt: Date | null;
};
type PositionRow = { inviteId: string; userId: string; lat: number; lng: number; accuracyM: number | null; updatedAt: Date };

const toSession = (r: SessionRow): FlashSessionRecord => ({
  id: r.id,
  userId: r.userId,
  startsAt: r.startsAt,
  expiresAt: r.expiresAt,
  endedAt: r.endedAt,
  note: r.note,
});
const toInvite = (r: InviteRow): FlashInviteRecord => ({
  id: r.id,
  fromUserId: r.fromUserId,
  toUserId: r.toUserId,
  status: r.status,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  respondedAt: r.respondedAt,
  endedAt: r.endedAt,
});
const toPosition = (r: PositionRow): FlashPositionRecord => ({
  inviteId: r.inviteId,
  userId: r.userId,
  lat: r.lat,
  lng: r.lng,
  accuracyM: r.accuracyM,
  updatedAt: r.updatedAt,
});

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? ((error as { code?: unknown }).code as string | undefined) : undefined;
}

/** Corrida entre duas requisições: P2034 (falha de serialização) ou P2002 (índice único parcial) viram CONFLICT. */
function isRace(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'P2034' || code === 'P2002';
}

export class PrismaFlashRepository implements FlashRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async findActiveSession(userId: string, now: Date): Promise<FlashSessionRecord | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.flashSession.findFirst({ where: { userId, endedAt: null, expiresAt: { gt: now } } });
    return row ? toSession(row) : undefined;
  }

  async listActiveSessions(userIds: string[], now: Date): Promise<FlashSessionRecord[]> {
    const valid = onlyUuids(userIds);
    if (valid.length === 0) return [];
    const rows = await this.prisma.flashSession.findMany({ where: { userId: { in: valid }, endedAt: null, expiresAt: { gt: now } } });
    return (rows as SessionRow[]).map(toSession);
  }

  async createSession(session: FlashSessionRecord, now: Date): Promise<void> {
    const message = 'Seu Flash já está ligado. Desligue para recomeçar.';
    try {
      await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Sessões que venceram sem ninguém desligar são fechadas aqui, para não bloquearem a nova.
          await tx.flashSession.updateMany({ where: { userId: session.userId, endedAt: null, expiresAt: { lte: now } }, data: { endedAt: now } });
          const open = await tx.flashSession.findFirst({ where: { userId: session.userId, endedAt: null }, select: { id: true } });
          if (open) throw conflict(message);
          await tx.flashSession.create({
            data: {
              id: session.id,
              userId: session.userId,
              startsAt: session.startsAt,
              expiresAt: session.expiresAt,
              endedAt: null,
              note: session.note,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (isRace(error)) throw conflict(message);
      throw error;
    }
  }

  async endSession(userId: string, now: Date): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const result = await this.prisma.flashSession.updateMany({
      where: { userId, endedAt: null, expiresAt: { gt: now } },
      data: { endedAt: now },
    });
    return result.count > 0;
  }

  async createInvite(invite: FlashInviteRecord, now: Date): Promise<void> {
    const message = 'Já existe um convite aberto entre vocês dois';
    try {
      await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const open = await tx.flashInvite.findMany({
            where: {
              status: { in: OPEN },
              OR: [
                { fromUserId: invite.fromUserId, toUserId: invite.toUserId },
                { fromUserId: invite.toUserId, toUserId: invite.fromUserId },
              ],
            },
          });
          for (const existing of open as InviteRow[]) {
            if (existing.expiresAt > now) throw conflict(message);
            await tx.flashInvite.update({
              where: { id: existing.id },
              data: { status: existing.status === 'ACCEPTED' ? 'ENDED' : 'EXPIRED', endedAt: now },
            });
            await tx.flashPosition.deleteMany({ where: { inviteId: existing.id } });
          }
          await tx.flashInvite.create({
            data: {
              id: invite.id,
              fromUserId: invite.fromUserId,
              toUserId: invite.toUserId,
              status: invite.status,
              createdAt: invite.createdAt,
              expiresAt: invite.expiresAt,
              respondedAt: invite.respondedAt,
              endedAt: invite.endedAt,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (isRace(error)) throw conflict(message);
      throw error;
    }
  }

  async getInvite(id: string): Promise<FlashInviteRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.flashInvite.findUnique({ where: { id } });
    return row ? toInvite(row) : undefined;
  }

  async saveInvite(invite: FlashInviteRecord): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.flashInvite.update({
        where: { id: invite.id },
        data: { status: invite.status, expiresAt: invite.expiresAt, respondedAt: invite.respondedAt, endedAt: invite.endedAt },
      });
      // Só encontro aceito compartilha posição: em qualquer outro estado ela é apagada.
      if (invite.status !== 'ACCEPTED') await tx.flashPosition.deleteMany({ where: { inviteId: invite.id } });
    });
  }

  async listOpenInvitesFor(userId: string, now: Date): Promise<FlashInviteRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.flashInvite.findMany({
      where: { status: { in: OPEN }, expiresAt: { gt: now }, OR: [{ fromUserId: userId }, { toUserId: userId }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return (rows as InviteRow[]).map(toInvite);
  }

  private async closeWhere(where: Prisma.FlashInviteWhereInput, now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = (await tx.flashInvite.findMany({ where: { AND: [{ status: { in: OPEN } }, where] }, select: { id: true, status: true } })) as {
        id: string;
        status: FlashInviteRecord['status'];
      }[];
      const pending = rows.filter((r) => r.status === 'PENDING').map((r) => r.id);
      const accepted = rows.filter((r) => r.status === 'ACCEPTED').map((r) => r.id);
      if (pending.length > 0) await tx.flashInvite.updateMany({ where: { id: { in: pending } }, data: { status: 'CANCELED', endedAt: now } });
      if (accepted.length > 0) await tx.flashInvite.updateMany({ where: { id: { in: accepted } }, data: { status: 'ENDED', endedAt: now } });
      if (rows.length > 0) await tx.flashPosition.deleteMany({ where: { inviteId: { in: rows.map((r) => r.id) } } });
      return rows.length;
    });
  }

  async closeOpenInvitesOf(userId: string, now: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.closeWhere({ OR: [{ fromUserId: userId }, { toUserId: userId }] }, now);
  }

  async closeOpenInvitesBetween(a: string, b: string, now: Date): Promise<number> {
    if (!isUuid(a) || !isUuid(b)) return 0;
    return this.closeWhere(
      {
        OR: [
          { fromUserId: a, toUserId: b },
          { fromUserId: b, toUserId: a },
        ],
      },
      now,
    );
  }

  async setHidden(record: FlashHiddenRecord): Promise<void> {
    const { ownerId, otherId, hideTheirs, hideMine } = record;
    if (!isUuid(ownerId) || !isUuid(otherId)) return;
    if (hideTheirs || hideMine) {
      await this.prisma.flashHidden.upsert({
        where: { ownerId_otherId: { ownerId, otherId } },
        create: { ownerId, otherId, hideTheirs, hideMine },
        update: { hideTheirs, hideMine },
      });
    } else {
      await this.prisma.flashHidden.deleteMany({ where: { ownerId, otherId } });
    }
  }

  async listHidden(userId: string): Promise<FlashHiddenRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.flashHidden.findMany({
      where: { OR: [{ ownerId: userId }, { otherId: userId }] },
      select: { ownerId: true, otherId: true, hideTheirs: true, hideMine: true },
    });
    return rows.map((r) => ({ ownerId: r.ownerId, otherId: r.otherId, hideTheirs: r.hideTheirs, hideMine: r.hideMine }));
  }

  async upsertPosition(position: FlashPositionRecord): Promise<void> {
    await this.prisma.flashPosition.upsert({
      where: { inviteId_userId: { inviteId: position.inviteId, userId: position.userId } },
      create: {
        inviteId: position.inviteId,
        userId: position.userId,
        lat: position.lat,
        lng: position.lng,
        accuracyM: position.accuracyM,
        updatedAt: position.updatedAt,
      },
      update: { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, updatedAt: position.updatedAt },
    });
  }

  async listPositions(inviteId: string): Promise<FlashPositionRecord[]> {
    if (!isUuid(inviteId)) return [];
    const rows = await this.prisma.flashPosition.findMany({ where: { inviteId } });
    return (rows as PositionRow[]).map(toPosition);
  }

  async purgeExpired(now: Date): Promise<{ invites: number; positions: number; removed: number }> {
    const cutoff = new Date(now.getTime() - DAY_MS);
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const expired = (await tx.flashInvite.findMany({
        where: { status: { in: OPEN }, expiresAt: { lte: now } },
        select: { id: true, status: true },
      })) as { id: string; status: FlashInviteRecord['status'] }[];
      const pending = expired.filter((r) => r.status === 'PENDING').map((r) => r.id);
      const accepted = expired.filter((r) => r.status === 'ACCEPTED').map((r) => r.id);
      if (pending.length > 0) await tx.flashInvite.updateMany({ where: { id: { in: pending } }, data: { status: 'EXPIRED', endedAt: now } });
      if (accepted.length > 0) await tx.flashInvite.updateMany({ where: { id: { in: accepted } }, data: { status: 'ENDED', endedAt: now } });

      const positions = await tx.flashPosition.deleteMany({ where: { invite: { status: { not: 'ACCEPTED' } } } });

      const oldSessions = await tx.flashSession.deleteMany({
        where: { OR: [{ endedAt: { lt: cutoff } }, { endedAt: null, expiresAt: { lt: cutoff } }] },
      });
      const oldInvites = await tx.flashInvite.deleteMany({ where: { status: { notIn: OPEN }, endedAt: { lt: cutoff } } });
      return { invites: expired.length, positions: positions.count, removed: oldSessions.count + oldInvites.count };
    });
  }
}
