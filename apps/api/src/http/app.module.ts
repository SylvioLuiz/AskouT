import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.ts';
import { AuthController } from './controllers/auth.controller.ts';
import { AvailabilityController } from './controllers/availability.controller.ts';
import { BlocksController } from './controllers/blocks.controller.ts';
import { FollowsController } from './controllers/follows.controller.ts';
import { ProfilesController } from './controllers/profiles.controller.ts';
import { coreProvider } from './core.provider.ts';
import { PrismaShutdown, prismaProvider } from './prisma.provider.ts';
import { loadConfig } from './support/config.ts';
import { CONFIG } from './tokens.ts';

@Module({
  controllers: [AuthController, ProfilesController, FollowsController, BlocksController, AvailabilityController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig(process.env) },
    prismaProvider,
    coreProvider,
    PrismaShutdown,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
