import { Hs256TokenService, ScryptPasswordHasher } from '../adapters/crypto.ts';
import { createCore } from '../index.ts';
import type { AuthResult } from '../auth-service.ts';
import {
  FakeClock,
  InMemoryBlockRepository,
  InMemoryFollowRepository,
  InMemoryUserRepository,
  SequentialIds,
} from './in-memory.ts';

export const TEST_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
export const PASSWORD = 'uma-senha-forte-123';

/** Monta o núcleo com repositórios em memória e hash rápido (custo baixo, só para testes). */
export function makeWorld() {
  const blocks = new InMemoryBlockRepository();
  const follows = new InMemoryFollowRepository(blocks);
  const users = new InMemoryUserRepository();
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const hasher = new ScryptPasswordHasher({ N: 2 ** 10 });
  const tokens = new Hs256TokenService({ secret: TEST_SECRET, nowMs: () => clock.now().getTime() });
  const core = createCore({ users, follows, blocks, hasher, tokens, clock, ids });

  /** Cria um usuário e devolve a sessão. */
  async function signUp(username: string, extra: { displayName?: string; email?: string } = {}): Promise<AuthResult> {
    clock.tick(1000);
    return core.auth.register({
      email: extra.email ?? `${username}@exemplo.com`,
      username,
      displayName: extra.displayName ?? username,
      password: PASSWORD,
    });
  }

  /** Cria vários usuários de uma vez e devolve os ids por username. */
  async function signUpMany(...names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) out[name] = (await signUp(name)).user.id;
    return out;
  }

  return { core, users, follows, blocks, clock, ids, hasher, tokens, signUp, signUpMany };
}
