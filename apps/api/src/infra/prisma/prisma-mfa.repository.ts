import type { PrismaClient } from '@prisma/client';
import type { MfaRepository } from '../../core/ports.ts';
import type { UserMfa } from '../../core/types.ts';
import { isRecordNotFound, isUuid } from './helpers.ts';

export class PrismaMfaRepository implements MfaRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async find(userId: string): Promise<UserMfa | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.userMfa.findUnique({ where: { userId } });
    return row
      ? {
          userId: row.userId,
          secretSealed: row.secretSealed,
          enabledAt: row.enabledAt,
          recoveryCodeHashes: row.recoveryCodeHashes,
          lastUsedStep: row.lastUsedStep,
          failedAttempts: row.failedAttempts,
          lockedUntil: row.lockedUntil,
          createdAt: row.createdAt,
        }
      : undefined;
  }

  async save(record: UserMfa): Promise<void> {
    const { userId, ...fields } = record;
    await this.prisma.userMfa.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
  }

  async delete(userId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.userMfa.deleteMany({ where: { userId } });
  }

  async useStep(userId: string, step: number): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const { count } = await this.prisma.userMfa.updateMany({ where: { userId, lastUsedStep: { lt: step } }, data: { lastUsedStep: step, failedAttempts: 0 } });
    return count === 1;
  }

  async useRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const count = await this.prisma.$executeRaw`
      UPDATE "UserMfa"
         SET "recoveryCodeHashes" = array_remove("recoveryCodeHashes", ${codeHash}), "failedAttempts" = 0
       WHERE "userId" = ${userId}::uuid AND ${codeHash} = ANY("recoveryCodeHashes")`;
    return count === 1;
  }

  async incrementFailures(userId: string): Promise<number | undefined> {
    if (!isUuid(userId)) return undefined;
    try {
      const row = await this.prisma.userMfa.update({ where: { userId }, data: { failedAttempts: { increment: 1 } }, select: { failedAttempts: true } });
      return row.failedAttempts;
    } catch (error) {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    }
  }

  async lock(userId: string, until: Date): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.userMfa.updateMany({ where: { userId }, data: { lockedUntil: until, failedAttempts: 0 } });
  }
}
