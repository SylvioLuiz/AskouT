import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './support/config.ts';
import { CONFIG, PRISMA } from './tokens.ts';

/** Cria o cliente do Prisma e conecta na subida (falha cedo se o banco estiver inacessível). */
export const prismaProvider = {
  provide: PRISMA,
  inject: [CONFIG],
  useFactory: async (config: AppConfig): Promise<PrismaClient> => {
    const { PrismaClient: Client } = await import('@prisma/client');
    const client = new Client({ datasourceUrl: config.databaseUrl });
    await client.$connect();
    return client;
  },
};

@Injectable()
export class PrismaShutdown implements OnApplicationShutdown {
  private readonly prisma: PrismaClient;

  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
