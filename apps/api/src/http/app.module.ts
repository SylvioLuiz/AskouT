import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.ts';
import { AuthController } from './controllers/auth.controller.ts';
import { AvailabilityController } from './controllers/availability.controller.ts';
import { BlocksController } from './controllers/blocks.controller.ts';
import { ConversationsController } from './controllers/conversations.controller.ts';
import { ExploreController } from './controllers/explore.controller.ts';
import { FlashController } from './controllers/flash.controller.ts';
import { FollowsController } from './controllers/follows.controller.ts';
import { ProfilesController } from './controllers/profiles.controller.ts';
import { PlacesController } from './controllers/places.controller.ts';
import { coreProvider, googleProvider, placePhotosProvider } from './core.provider.ts';
import { FlashPurge } from './flash-purge.ts';
import { PrismaShutdown, prismaProvider } from './prisma.provider.ts';
import { loadConfig } from './support/config.ts';
import { CONFIG } from './tokens.ts';

@Module({
  controllers: [AuthController, ProfilesController, FollowsController, BlocksController, AvailabilityController, FlashController, ConversationsController, PlacesController, ExploreController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig(process.env) },
    prismaProvider,
    googleProvider,
    placePhotosProvider,
    coreProvider,
    PrismaShutdown,
    FlashPurge,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
