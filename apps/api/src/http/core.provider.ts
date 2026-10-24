import { AppleJwsPurchaseVerifier } from '../infra/store/apple-purchase-verifier.ts';
import type { PrismaClient } from '@prisma/client';
import { HmacOneTimeCodes, Hs256TokenService, ScryptPasswordHasher } from '../core/adapters/crypto.ts';
import { SystemClock, UuidGenerator } from '../core/adapters/system.ts';
import { createCore } from '../core/index.ts';
import {
  PrismaAvailabilityRepository,
  PrismaBlockRepository,
  PrismaConversationRepository,
  PrismaMeetupRepository,
  PrismaSchedulingRepository,
  PrismaNotificationRepository,
  PrismaEventRoomRepository,
  PrismaProfileEventRepository,
  PrismaPostRepository,
  PrismaPushSubscriptionRepository,
  PrismaPlaceRepository,
  PrismaVenueClaimRepository,
  PrismaCalendarRepository,
  PrismaAdminRepository,
  PrismaFlashRepository,
  PrismaFollowRepository,
  PrismaPasswordResetRepository,
  PrismaBoostRepository,
  PrismaAppSettingsRepository,
  PrismaDwellRepository, PrismaRegionRepository, PrismaAccountRepository,
  PrismaPendingSignupRepository,
  PrismaIdentityRepository,
  PrismaUserRepository,
} from '../infra/prisma/index.ts';
import { DisabledPushSender, WebPushSender } from '../infra/push/web-push-sender.ts';
import { OidcIdentityVerifier } from '../infra/identity/oidc-verifier.ts';
import { GooglePlaceSource } from '../infra/google/google-place-source.ts';
import { FallbackPlaceSource } from '../infra/places/fallback-place-source.ts';
import { OverpassPlaceSource } from '../infra/overpass/overpass-place-source.ts';
import { SandboxPaymentGateway, UnconfiguredPaymentGateway } from '../infra/payments/sandbox-payment-gateway.ts';
import { StripePaymentGateway } from '../infra/payments/stripe-payment-gateway.ts';
import { ConsoleEmailSender } from './console-email-sender.ts';
import { ResendEmailSender } from '../infra/email/resend-email-sender.ts';
import { HttpCalendarFetcher } from '../infra/calendar/http-calendar-fetcher.ts';
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
      scheduling: new PrismaSchedulingRepository(prisma),
      profileEvents: new PrismaProfileEventRepository(prisma),
      posts: new PrismaPostRepository(prisma),
      eventRoom: new PrismaEventRoomRepository(prisma),
      notifications: new PrismaNotificationRepository(prisma),
      pushSubscriptions: new PrismaPushSubscriptionRepository(prisma),
      push: config.vapid ? new WebPushSender({ keys: { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey }, subject: config.vapid.subject }) : new DisabledPushSender(),
      places: new PrismaPlaceRepository(prisma),
      claims: new PrismaVenueClaimRepository(prisma),
      calendars: new PrismaCalendarRepository(prisma),
      calendarFetcher: new HttpCalendarFetcher(),
      admin: new PrismaAdminRepository(prisma),
      placeSource: google ? new FallbackPlaceSource(google, new OverpassPlaceSource({ contact: config.osmContact })) : new OverpassPlaceSource({ contact: config.osmContact }),
      pending: new PrismaPendingSignupRepository(prisma),
      passwordResets: new PrismaPasswordResetRepository(prisma),
      boosts: new PrismaBoostRepository(prisma),
      settings: new PrismaAppSettingsRepository(prisma),
      dwell: new PrismaDwellRepository(prisma),
      regions: new PrismaRegionRepository(prisma),
      account: new PrismaAccountRepository(prisma),
      payments: config.stripe ? new StripePaymentGateway(config.stripe) : config.paymentProvider === 'sandbox' ? new SandboxPaymentGateway() : new UnconfiguredPaymentGateway(),
      ...(config.boostPricePerDayCents === undefined ? {} : { boostPricePerDayCents: config.boostPricePerDayCents }),
      ...(config.boostStorePricePerDayCents === undefined ? {} : { boostStorePricePerDayCents: config.boostStorePricePerDayCents }),
      boostsEnabled: config.paymentsEnabled,
      // Compra pela App Store só liga com o bundle id do app configurado (APPLE_APP_ID). Google Play ainda não é conferido.
      ...(config.appleAppId ? { storeVerifier: new AppleJwsPurchaseVerifier({ bundleId: config.appleAppId }) } : {}),
      identities: new PrismaIdentityRepository(prisma),
      verifier: new OidcIdentityVerifier({ googleClientId: config.googleClientId, appleClientId: config.appleClientId, appleAppId: config.appleAppId }),
      mailer: config.resend ? new ResendEmailSender(config.resend) : new ConsoleEmailSender(),
      codes: new HmacOneTimeCodes({ secret: config.codeSecret }),
      hasher: new ScryptPasswordHasher(),
      tokens: new Hs256TokenService({ secret: config.jwtSecret, ttlSeconds: config.tokenTtlSeconds }),
      clock: new SystemClock(),
      ids: new UuidGenerator(),
    }),
};
