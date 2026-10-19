import type { PrismaClient } from '@prisma/client';
import type { IdentityRepository } from '../../core/ports.ts';
import type { ExternalProvider } from '../../core/types.ts';

export class PrismaIdentityRepository implements IdentityRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async find(provider: ExternalProvider, subject: string): Promise<string | undefined> {
    const row = await this.prisma.externalIdentity.findUnique({ where: { provider_subject: { provider, subject } } });
    return row?.userId;
  }

  async link(provider: ExternalProvider, subject: string, userId: string, at: Date): Promise<void> {
    await this.prisma.externalIdentity.upsert({
      where: { provider_subject: { provider, subject } },
      create: { provider, subject, userId, createdAt: at },
      update: {},
    });
  }
}
