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
  InMemoryPushSubscriptionRepository,
  FakePushSender,
  InMemoryPlaceRepository,
  InMemoryAvailabilityRepository,
  InMemoryFlashRepository,
  FakeEmailSender,
  InMemoryBlockRepository,
  InMemoryFollowRepository,
  InMemoryPendingSignupRepository,
  InMemoryUserRepository,
  SequentialIds,
} from './in-memory.ts';

export const TEST_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
export const PASSWORD = 'uma-senha-forte-123';

/** Monta o núcleo com repositórios em memória e hash rápido (custo baixo, só para testes). */
export function makeWorld() {
  const blocks = new InMemoryBlockRepository();
  const follows = new InMemoryFollowRepository(blocks);
  const availability = new InMemoryAvailabilityRepository();
  const flash = new InMemoryFlashRepository();
  const conversations = new InMemoryConversationRepository();
  const meetups = new InMemoryMeetupRepository();
  const profileEvents = new InMemoryProfileEventRepository();
  const posts = new InMemoryPostRepository();
  const eventRoom = new InMemoryEventRoomRepository(posts);
  const notifications = new InMemoryNotificationRepository();
  const pushSubscriptions = new InMemoryPushSubscriptionRepository();
  const push = new FakePushSender();
  const places = new InMemoryPlaceRepository();
  const placeSource = new FakePlaceSource();
  const users = new InMemoryUserRepository();
  const pending = new InMemoryPendingSignupRepository();
  const mailer = new FakeEmailSender();
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const hasher = new ScryptPasswordHasher({ N: 2 ** 10 });
  const tokens = new Hs256TokenService({ secret: TEST_SECRET, nowMs: () => clock.now().getTime() });
  // Códigos previsíveis nos testes (100001, 100002, ...), mas com o HMAC de verdade.
  let codeCounter = 100000;
  const codes = new HmacOneTimeCodes({ secret: TEST_SECRET, generate: () => String((codeCounter += 1)) });
  const core = createCore({ users, follows, blocks, availability, flash, conversations, meetups, profileEvents, posts, eventRoom, notifications, pushSubscriptions, push, places, placeSource, pending, mailer, codes, hasher, tokens, clock, ids });

  /** Cadastro completo (dados -> código por e-mail -> confirmação). Devolve a sessão. */
  async function signUp(username: string, extra: { displayName?: string; email?: string } = {}): Promise<AuthResult> {
    clock.tick(1000);
    const email = (extra.email ?? `${username}@exemplo.com`).toLowerCase();
    await core.auth.startSignup({ email, username, displayName: extra.displayName ?? username, password: PASSWORD });
    return core.auth.confirmSignup({ email, code: mailer.lastCodeFor(email) });
  }

  /** Cria vários usuários de uma vez e devolve os ids por username. */
  async function signUpMany(...names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) out[name] = (await signUp(name)).user.id;
    return out;
  }

  return { core, users, follows, blocks, availability, flash, conversations, meetups, profileEvents, posts, eventRoom, notifications, pushSubscriptions, push, places, placeSource, pending, mailer, clock, ids, hasher, tokens, codes, signUp, signUpMany };
}
