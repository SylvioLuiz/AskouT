import type { PrismaClient } from '@prisma/client';
import { HmacOneTimeCodes, Hs256TokenService, ScryptPasswordHasher } from '../core/adapters/crypto.ts';
import { SystemClock, UuidGenerator } from '../core/adapters/system.ts';
import { createCore } from '../core/index.ts';
import {
  PrismaAvailabilityRepository,
  PrismaBlockRepository,
  PrismaFlashRepository,
  PrismaFollowRepository,
  PrismaPendingSignupRepository,
  PrismaUserRepository,
} from '../infra/prisma/index.ts';
import { ConsoleEmailSender } from './console-email-sender.ts';
import type { AppConfig } from './support/config.ts';
import { CONFIG, CORE, PRISMA } from './tokens.ts';

/** Monta o núcleo com os adaptadores reais (Postgres via Prisma, scrypt, JWT, relógio e UUID do sistema). */
export const coreProvider = {
  provide: CORE,
  inject: [CONFIG, PRISMA],
  useFactory: (config: AppConfig, prisma: PrismaClient) =>
    createCore({
      users: new PrismaUserRepository(prisma),
      follows: new PrismaFollowRepository(prisma),
      blocks: new PrismaBlockRepository(prisma),
      availability: new PrismaAvailabilityRepository(prisma),
      flash: new PrismaFlashRepository(prisma),
      pending: new PrismaPendingSignupRepository(prisma),
      mailer: new ConsoleEmailSender(),
      codes: new HmacOneTimeCodes({ secret: config.codeSecret }),
      hasher: new ScryptPasswordHasher(),
      tokens: new Hs256TokenService({ secret: config.jwtSecret, ttlSeconds: config.tokenTtlSeconds }),
      clock: new SystemClock(),
      ids: new UuidGenerator(),
    }),
};
