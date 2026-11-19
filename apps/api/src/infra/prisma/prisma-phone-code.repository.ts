import type { PrismaClient } from '@prisma/client';
import type { PhoneCodeRepository } from '../../core/ports.ts';
import type { PhoneCode } from '../../core/types.ts';
import { isRecordNotFound, isUuid } from './helpers.ts';

export class PrismaPhoneCodeRepository implements PhoneCodeRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async find(userId: string): Promise<PhoneCode | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.phoneCode.findUnique({ where: { userId } });
    return row ? { userId: row.userId, purpose: row.purpose === 'VERIFY' ? 'VERIFY' : 'LOGIN', phone: row.phone, codeHash: row.codeHash, expiresAt: row.expiresAt, attempts: row.attempts, sendCount: row.sendCount, lastSentAt: row.lastSentAt } : undefined;
  }

  async save(code: PhoneCode): Promise<void> {
    const { userId, ...fields } = code;
    await this.prisma.phoneCode.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });
  }

  async delete(userId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.phoneCode.deleteMany({ where: { userId } });
  }

  async incrementAttempts(userId: string): Promise<number | undefined> {
    if (!isUuid(userId)) return undefined;
    try {
      const row = await this.prisma.phoneCode.update({ where: { userId }, data: { attempts: { increment: 1 } }, select: { attempts: true } });
      return row.attempts;
    } catch (error) {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    }
  }
}
