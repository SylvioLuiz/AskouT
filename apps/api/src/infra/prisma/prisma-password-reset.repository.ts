import type { PrismaClient } from '@prisma/client';
import type { PasswordResetRepository } from '../../core/ports.ts';
import type { PasswordReset } from '../../core/types.ts';
import { isRecordNotFound, isUuid } from './helpers.ts';

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async find(userId: string): Promise<PasswordReset | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.passwordReset.findUnique({ where: { userId } });
    return row ? { userId: row.userId, channel: 'EMAIL', codeHash: row.codeHash, expiresAt: row.expiresAt, attempts: row.attempts, sendCount: row.sendCount, lastSentAt: row.lastSentAt } : undefined;
  }

  async save(reset: PasswordReset): Promise<void> {
    const { userId, ...fields } = reset;
    await this.prisma.passwordReset.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
  }

  async delete(userId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.passwordReset.deleteMany({ where: { userId } });
  }

  async incrementAttempts(userId: string): Promise<number | undefined> {
    if (!isUuid(userId)) return undefined;
    try {
      const row = await this.prisma.passwordReset.update({ where: { userId }, data: { attempts: { increment: 1 } }, select: { attempts: true } });
      return row.attempts;
    } catch (error) {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    }
  }
}
