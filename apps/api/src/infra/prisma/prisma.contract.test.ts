import { defineRepositoryContract } from '../../core/testing/contracts.ts';
import type { RepoHarness } from '../../core/testing/contracts.ts';
import type { UserStatus } from '../../core/types.ts';
import {
  PrismaBlockRepository,
  PrismaFollowRepository,
  PrismaPendingSignupRepository,
  PrismaUserRepository,
} from './index.ts';

/**
 * Roda a suíte de contrato nos repositórios Prisma, contra um Postgres de TESTE.
 *
 * ATENÇÃO: a cada teste todas as tabelas são APAGADAS (TRUNCATE). Por isso:
 *  - usa uma variável própria, ASKOUT_TEST_DATABASE_URL (nunca a DATABASE_URL de desenvolvimento);
 *  - recusa rodar se o nome do banco não terminar em "_test".
 *
 * Sem a variável, os testes são pulados (é o que acontece no `npm test` comum).
 */
const url = process.env.ASKOUT_TEST_DATABASE_URL;

function assertSafeDatabase(raw: string): void {
  const dbName = new URL(raw).pathname.replace(/^\//, '').split('?')[0] ?? '';
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Recusado: o banco "${dbName}" não termina em "_test". Os testes apagam todos os dados; use um banco só para testes.`,
    );
  }
}

async function makePrismaHarness(): Promise<RepoHarness> {
  assertSafeDatabase(url!);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: url });
  await prisma.$connect();

  return {
    users: new PrismaUserRepository(prisma),
    follows: new PrismaFollowRepository(prisma),
    blocks: new PrismaBlockRepository(prisma),
    pending: new PrismaPendingSignupRepository(prisma),
    async setUserStatus(userId: string, status: UserStatus) {
      await prisma.user.update({ where: { id: userId }, data: { status } });
    },
    async reset() {
      // CASCADE leva junto todas as tabelas que referenciam "User"; PendingSignup não tem chave estrangeira.
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "PendingSignup" CASCADE');
    },
    async close() {
      await prisma.$disconnect();
    },
  };
}

defineRepositoryContract('Prisma/Postgres', makePrismaHarness, {
  skip: url ? false : 'defina ASKOUT_TEST_DATABASE_URL (um Postgres de TESTE, banco terminado em _test) para rodar',
});
