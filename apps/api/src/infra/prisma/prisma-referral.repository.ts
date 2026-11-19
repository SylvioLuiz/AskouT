import type { PrismaClient } from '@prisma/client';
import type { ReferralRecord, ReferralRepository } from '../../core/ports.ts';
import { isUuid } from './helpers.ts';

export class PrismaReferralRepository implements ReferralRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(record: ReferralRecord): Promise<boolean> {
    // A chave é a pessoa convidada: se já existe, o primeiro convite continua valendo.
    const result = await this.prisma.referral.createMany({
      data: [{ inviteeId: record.inviteeId, inviterId: record.inviterId, createdAt: record.createdAt, qualifiedAt: record.qualifiedAt }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async qualify(inviteeId: string, at: Date): Promise<boolean> {
    if (!isUuid(inviteeId)) return false;
    const result = await this.prisma.referral.updateMany({ where: { inviteeId, qualifiedAt: null }, data: { qualifiedAt: at } });
    return result.count > 0;
  }

  async listByInviter(inviterId: string, limit: number): Promise<ReferralRecord[]> {
    if (!isUuid(inviterId)) return [];
    const rows = await this.prisma.referral.findMany({
      where: { inviterId },
      orderBy: [{ createdAt: 'desc' }, { inviteeId: 'asc' }],
      take: limit,
    });
    return rows.map((r) => ({ inviteeId: r.inviteeId, inviterId: r.inviterId, createdAt: r.createdAt, qualifiedAt: r.qualifiedAt }));
  }

  async top(limit: number): Promise<{ inviterId: string; total: number; confirmed: number }[]> {
    const rows = await this.prisma.$queryRaw<{ inviterId: string; total: bigint; confirmed: bigint }[]>`
      SELECT r."inviterId" AS "inviterId",
             COUNT(*) AS total,
             COUNT(r."qualifiedAt") AS confirmed
        FROM "Referral" r
        JOIN "User" u ON u."id" = r."inviteeId"
       WHERE u."status" = 'ACTIVE'
       GROUP BY r."inviterId"
       ORDER BY confirmed DESC, total DESC, r."inviterId" ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ inviterId: r.inviterId, total: Number(r.total), confirmed: Number(r.confirmed) }));
  }
}
