import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.ts';
import { AuthController } from './controllers/auth.controller.ts';
import { AvailabilityController } from './controllers/availability.controller.ts';
import { BlocksController } from './controllers/blocks.controller.ts';
import { ConversationsController } from './controllers/conversations.controller.ts';
import { MeetupsController } from './controllers/meetups.controller.ts';
import { DatePollsController } from './controllers/date-polls.controller.ts';
import { NotificationsController } from './controllers/notifications.controller.ts';
import { PostsController } from './controllers/posts.controller.ts';
import { ExploreController } from './controllers/explore.controller.ts';
import { AdminController } from './controllers/admin.controller.ts';
import { VenuesController } from './controllers/venues.controller.ts';
import { FlashController } from './controllers/flash.controller.ts';
import { FollowsController } from './controllers/follows.controller.ts';
import { ProfilesController, AvatarController } from './controllers/profiles.controller.ts';
import { PlacesController } from './controllers/places.controller.ts';
import { coreProvider, googleProvider, placePhotosProvider } from './core.provider.ts';
import { FlashPurge } from './flash-purge.ts';
import { PollDeadlines } from './poll-deadlines.ts';
import { PrismaShutdown, prismaProvider } from './prisma.provider.ts';
import { loadConfig } from './support/config.ts';
import { CONFIG } from './tokens.ts';

@Module({
  controllers: [AuthController, ProfilesController, FollowsController, BlocksController, AvailabilityController, FlashController, ConversationsController, PlacesController, ExploreController, VenuesController, MeetupsController, DatePollsController, NotificationsController, AvatarController, PostsController, AdminController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig(process.env) },
    prismaProvider,
    googleProvider,
    placePhotosProvider,
    coreProvider,
    PrismaShutdown,
    FlashPurge,
    PollDeadlines,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
