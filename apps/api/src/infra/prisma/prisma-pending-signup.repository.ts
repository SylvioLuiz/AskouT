import type { PrismaClient } from '@prisma/client';
import type { PendingSignupRepository } from '../../core/ports.ts';
import type { PendingSignup } from '../../core/types.ts';
import { isRecordNotFound } from './helpers.ts';

function toPending(row: PendingSignup): PendingSignup {
  return {
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    attempts: row.attempts,
    sendCount: row.sendCount,
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
  };
}

export class PrismaPendingSignupRepository implements PendingSignupRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async find(email: string): Promise<PendingSignup | undefined> {
    const row = await this.prisma.pendingSignup.findUnique({ where: { email } });
    return row ? toPending(row) : undefined;
  }

  async save(pending: PendingSignup): Promise<void> {
    const { email, ...fields } = pending;
    await this.prisma.pendingSignup.upsert({
      where: { email },
      create: { email, ...fields },
      update: fields,
    });
  }

  async delete(email: string): Promise<void> {
    await this.prisma.pendingSignup.deleteMany({ where: { email } });
  }

  /** UPDATE ... SET attempts = attempts + 1 é atômico no Postgres: tentativas simultâneas não se perdem. */
  async incrementAttempts(email: string): Promise<number | undefined> {
    try {
      const row = await this.prisma.pendingSignup.update({
        where: { email },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      return row.attempts;
    } catch (error) {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    }
  }
}
