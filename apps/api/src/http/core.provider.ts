import type { PrismaClient } from '@prisma/client';
import { HmacOneTimeCodes, Hs256TokenService, ScryptPasswordHasher } from '../core/adapters/crypto.ts';
import { SystemClock, UuidGenerator } from '../core/adapters/system.ts';
import { createCore } from '../core/index.ts';
import {
  PrismaAvailabilityRepository,
  PrismaBlockRepository,
  PrismaConversationRepository,
  PrismaMeetupRepository,
  PrismaNotificationRepository,
  PrismaEventRoomRepository,
  PrismaProfileEventRepository,
  PrismaPostRepository,
  PrismaPushSubscriptionRepository,
  PrismaPlaceRepository,
  PrismaVenueClaimRepository,
  PrismaFlashRepository,
  PrismaFollowRepository,
  PrismaPendingSignupRepository,
  PrismaUserRepository,
} from '../infra/prisma/index.ts';
import { DisabledPushSender, WebPushSender } from '../infra/push/web-push-sender.ts';
import { GooglePlaceSource } from '../infra/google/google-place-source.ts';
import { FallbackPlaceSource } from '../infra/places/fallback-place-source.ts';
import { OverpassPlaceSource } from '../infra/overpass/overpass-place-source.ts';
import { ConsoleEmailSender } from './console-email-sender.ts';
import type { AppConfig } from './support/config.ts';
import { PhotoSigner } from './support/photo-signing.ts';
import { CONFIG, CORE, PLACE_PHOTOS, PRISMA } from './tokens.ts';

/** Fonte do Google, só se houver chave. Compartilhada entre a busca de lugares e o proxy de fotos. */
export const googleProvider = {
  provide: 'GOOGLE_SOURCE',
  inject: [CONFIG],
  useFactory: (config: AppConfig) =>
    config.googlePlacesKey ? new GooglePlaceSource({ apiKey: config.googlePlacesKey, dailyLimit: config.googleDailyLimit }) : undefined,
};

export const placePhotosProvider = {
  provide: PLACE_PHOTOS,
  inject: [CONFIG, 'GOOGLE_SOURCE'],
  useFactory: (config: AppConfig, google: GooglePlaceSource | undefined) => ({ google, signer: new PhotoSigner(config.codeSecret) }),
};

/** Monta o núcleo com os adaptadores reais (Postgres via Prisma, scrypt, JWT, relógio e UUID do sistema). */
export const coreProvider = {
  provide: CORE,
  inject: [CONFIG, PRISMA, 'GOOGLE_SOURCE'],
  useFactory: (config: AppConfig, prisma: PrismaClient, google: GooglePlaceSource | undefined) =>
    createCore({
      users: new PrismaUserRepository(prisma),
      follows: new PrismaFollowRepository(prisma),
      blocks: new PrismaBlockRepository(prisma),
      availability: new PrismaAvailabilityRepository(prisma),
      flash: new PrismaFlashRepository(prisma),
      conversations: new PrismaConversationRepository(prisma),
      meetups: new PrismaMeetupRepository(prisma),
      profileEvents: new PrismaProfileEventRepository(prisma),
      posts: new PrismaPostRepository(prisma),
      eventRoom: new PrismaEventRoomRepository(prisma),
      notifications: new PrismaNotificationRepository(prisma),
      pushSubscriptions: new PrismaPushSubscriptionRepository(prisma),
      push: config.vapid ? new WebPushSender({ keys: { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey }, subject: config.vapid.subject }) : new DisabledPushSender(),
      places: new PrismaPlaceRepository(prisma),
      claims: new PrismaVenueClaimRepository(prisma),
      placeSource: google ? new FallbackPlaceSource(google, new OverpassPlaceSource({ contact: config.osmContact })) : new OverpassPlaceSource({ contact: config.osmContact }),
      pending: new PrismaPendingSignupRepository(prisma),
      mailer: new ConsoleEmailSender(),
      codes: new HmacOneTimeCodes({ secret: config.codeSecret }),
      hasher: new ScryptPasswordHasher(),
      tokens: new Hs256TokenService({ secret: config.jwtSecret, ttlSeconds: config.tokenTtlSeconds }),
      clock: new SystemClock(),
      ids: new UuidGenerator(),
    }),
};
