import { HmacOneTimeCodes, Hs256TokenService, ScryptPasswordHasher } from '../adapters/crypto.ts';
import { createCore } from '../index.ts';
import type { AuthResult } from '../auth-service.ts';
import {
  FakeClock,
  FakePlaceSource,
  InMemoryConversationRepository, InMemoryMeetupRepository,
  InMemoryNotificationRepository,
  InMemoryProfileEventRepository,
  InMemoryPostRepository,
  InMemoryEventRoomRepository,
  InMemorySchedulingRepository,
  InMemoryPushSubscriptionRepository,
  FakePushSender,
  InMemoryPlaceRepository,
  InMemoryAvailabilityRepository,
  InMemoryFlashRepository,
  FakeEmailSender,
  InMemoryBlockRepository,
  InMemoryFollowRepository,
  InMemoryPasswordResetRepository,
  InMemoryBoostRepository,
  InMemoryDwellRepository,
  InMemoryRegionRepository,
  InMemoryAccountRepository,
  FakePaymentGateway,
  FakeStoreVerifier,
  InMemoryAppSettingsRepository,
  InMemoryPendingSignupRepository,
  InMemoryIdentityRepository,
  FakeIdentityVerifier,
  InMemoryVenueClaimRepository,
  InMemoryCalendarRepository,
  FakeCalendarFetcher,
  InMemoryAdminRepository,
  InMemoryUserRepository,
  SequentialIds,
} from './in-memory.ts';

export const TEST_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
export const PASSWORD = 'uma-senha-forte-123';

/** Monta o núcleo com repositórios em memória e hash rápido (custo baixo, só para testes). */
export function makeWorld(options: { payments?: FakePaymentGateway; boostsEnabled?: boolean; store?: FakeStoreVerifier; storePricePerDayCents?: number; pricePerDayCents?: number } = {}) {
  const blocks = new InMemoryBlockRepository();
  const follows = new InMemoryFollowRepository(blocks);
  const availability = new InMemoryAvailabilityRepository();
  const flash = new InMemoryFlashRepository();
  const conversations = new InMemoryConversationRepository();
  const meetups = new InMemoryMeetupRepository();
  const scheduling = new InMemorySchedulingRepository();
  const profileEvents = new InMemoryProfileEventRepository();
  const posts = new InMemoryPostRepository();
  const eventRoom = new InMemoryEventRoomRepository(posts);
  const notifications = new InMemoryNotificationRepository();
  const pushSubscriptions = new InMemoryPushSubscriptionRepository();
  const push = new FakePushSender();
  const places = new InMemoryPlaceRepository();
  const claims = new InMemoryVenueClaimRepository();
  const calendars = new InMemoryCalendarRepository();
  const calendarFetcher = new FakeCalendarFetcher();
  const placeSource = new FakePlaceSource();
  const users = new InMemoryUserRepository();
  const admin = new InMemoryAdminRepository({ users, posts, conversations, places, claims, eventRoom });
  const pending = new InMemoryPendingSignupRepository();
  const passwordResets = new InMemoryPasswordResetRepository();
  const boosts = new InMemoryBoostRepository();
  const dwell = new InMemoryDwellRepository();
  const regions = new InMemoryRegionRepository();
  const identitiesRepo = new InMemoryIdentityRepository();
  const account = new InMemoryAccountRepository(users, follows, blocks, regions, identitiesRepo);
  const payments = options.payments ?? new FakePaymentGateway();
  const store = options.store;
  const settings = new InMemoryAppSettingsRepository();
  const identities = identitiesRepo;
  const verifier = new FakeIdentityVerifier();
  const mailer = new FakeEmailSender();
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const hasher = new ScryptPasswordHasher({ N: 2 ** 10 });
  const tokens = new Hs256TokenService({ secret: TEST_SECRET, nowMs: () => clock.now().getTime() });
  // Códigos previsíveis nos testes (100001, 100002, ...), mas com o HMAC de verdade.
  let codeCounter = 100000;
  const codes = new HmacOneTimeCodes({ secret: TEST_SECRET, generate: () => String((codeCounter += 1)) });
  const core = createCore({ users, follows, blocks, availability, flash, conversations, meetups, scheduling, profileEvents, posts, eventRoom, notifications, pushSubscriptions, push, places, claims, calendars, calendarFetcher, admin, placeSource, pending, passwordResets, boosts, dwell, regions, account, payments, settings, ...(store ? { storeVerifier: store } : {}), ...(options.boostsEnabled === undefined ? {} : { boostsEnabled: options.boostsEnabled }), ...(options.pricePerDayCents === undefined ? {} : { boostPricePerDayCents: options.pricePerDayCents }), ...(options.storePricePerDayCents === undefined ? {} : { boostStorePricePerDayCents: options.storePricePerDayCents }), identities, verifier, mailer, codes, hasher, tokens, clock, ids });

  /** Cadastro completo (dados -> código por e-mail -> confirmação). Devolve a sessão. */
  async function signUp(username: string, extra: { displayName?: string; email?: string; minor?: boolean } = {}): Promise<AuthResult> {
    clock.tick(1000);
    const email = (extra.email ?? `${username}@exemplo.com`).toLowerCase();
    // Nos testes, todo mundo é maior de idade, salvo `minor` (17 anos).
    const birthDate = extra.minor ? `${clock.now().getUTCFullYear() - 17}-01-01` : '1990-01-01';
    await core.auth.startSignup({ email, username, displayName: extra.displayName ?? username, password: PASSWORD, birthDate, acceptTerms: true });
    return core.auth.confirmSignup({ email, code: mailer.lastCodeFor(email) });
  }

  /** Cria vários usuários de uma vez e devolve os ids por username. */
  async function signUpMany(...names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) out[name] = (await signUp(name)).user.id;
    return out;
  }

  return { core, users, follows, blocks, availability, flash, conversations, meetups, scheduling, profileEvents, posts, eventRoom, notifications, pushSubscriptions, push, places, claims, calendars, calendarFetcher, admin, placeSource, pending, passwordResets, boosts, dwell, regions, account, payments, settings, identities, verifier, mailer, clock, ids, hasher, tokens, codes, signUp, signUpMany };
}
