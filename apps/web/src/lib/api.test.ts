import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from './api.ts';
import type { FetchLike } from './api.ts';
import { ApiError } from './errors.ts';

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

function setup(reply: { status?: number; body?: unknown; headers?: Record<string, string>; throws?: boolean; badJson?: boolean }) {
  const calls: Call[] = [];
  let unauthorized = 0;
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers ?? {}, body: typeof init?.body === 'string' ? init.body : undefined });
    if (reply.throws) throw new TypeError('Failed to fetch');
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => reply.headers?.[name] ?? null },
      json: async () => {
        if (reply.badJson) throw new SyntaxError('Unexpected token');
        return reply.body;
      },
      blob: async () => new Blob(),
    };
  };
  let token: string | undefined = 'tok123';
  const api = createApi({
    baseUrl: '/api',
    fetch: fetchStub,
    getToken: () => token,
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });
  return {
    api,
    calls,
    unauthorizedCount: () => unauthorized,
    setToken: (t: string | undefined) => {
      token = t;
    },
  };
}

describe('cliente da API', () => {
  it('envia o token nas rotas autenticadas e monta URL e método', async () => {
    const t = setup({ body: { id: '1' } });
    const result = await t.api.me();
    assert.deepEqual(result, { id: '1' });
    assert.equal(t.calls[0]?.url, '/api/auth/me');
    assert.equal(t.calls[0]?.method, 'GET');
    assert.equal(t.calls[0]?.headers['Authorization'], 'Bearer tok123');
    assert.equal(t.calls[0]?.body, undefined);
  });

  it('não envia token em cadastro e login, e manda JSON no corpo', async () => {
    const t = setup({ body: { token: 'x' } });
    await t.api.login('@ana', 'segredo-forte');
    const call = t.calls[0];
    assert.equal(call?.headers['Authorization'], undefined);
    assert.equal(call?.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(call?.body ?? ''), { identifier: '@ana', password: 'segredo-forte' });
    await t.api.confirmSignup('a@b.co', '123456');
    await t.api.startSignup({ email: 'a@b.co', username: 'ana', password: 'x' });
    await t.api.resendSignupCode('a@b.co');
    assert.ok(t.calls.every((c) => c.headers['Authorization'] === undefined));
  });

  it('codifica parâmetros na URL', async () => {
    const t = setup({ body: [] });
    await t.api.searchProfiles('ana maria&x=1', 10);
    assert.equal(t.calls[0]?.url, '/api/profiles/search?q=ana%20maria%26x%3D1&limit=10');
    await t.api.getProfile('a/b');
    assert.equal(t.calls[1]?.url, '/api/profiles/a%2Fb');
    await t.api.followers('u 1', { limit: 20, offset: 40 });
    assert.equal(t.calls[2]?.url, '/api/users/u%201/followers?limit=20&offset=40');
    await t.api.following('u1');
    assert.equal(t.calls[3]?.url, '/api/users/u1/following');
  });

  it('usa o método certo em cada ação', async () => {
    const t = setup({ body: {} });
    await t.api.follow('u1');
    await t.api.unfollow('u1');
    await t.api.block('u1');
    await t.api.unblock('u1');
    await t.api.approveRequest('u1');
    await t.api.rejectRequest('u1');
    await t.api.removeFollower('u1');
    await t.api.updateProfile({ bio: 'oi' });
    await t.api.setPrivacy(true);
    assert.deepEqual(
      t.calls.map((c) => `${c.method} ${c.url}`),
      [
        'POST /api/users/u1/follow',
        'DELETE /api/users/u1/follow',
        'POST /api/users/u1/block',
        'DELETE /api/users/u1/block',
        'POST /api/me/follow-requests/u1/approve',
        'POST /api/me/follow-requests/u1/reject',
        'DELETE /api/me/followers/u1',
        'PATCH /api/profiles/me',
        'PATCH /api/profiles/me/privacy',
      ],
    );
    assert.deepEqual(JSON.parse(t.calls[8]?.body ?? ''), { isPrivate: true });
  });

  it('transforma erro da API em ApiError com campos e código', async () => {
    const t = setup({
      status: 400,
      body: { error: { code: 'VALIDATION', message: 'Dados inválidos', details: { username: 'Nome em uso', n: 3 } } },
    });
    await assert.rejects(t.api.startSignup({ email: 'a', username: 'b', password: 'c' }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, 'VALIDATION');
      assert.equal(e.status, 400);
      assert.equal(e.message, 'Dados inválidos');
      assert.deepEqual(e.fields, { username: 'Nome em uso' });
      return true;
    });
  });

  it('lê o Retry-After do limite de tentativas', async () => {
    const t = setup({
      status: 429,
      headers: { 'Retry-After': '42' },
      body: { error: { code: 'RATE_LIMITED', message: 'Aguarde' } },
    });
    await assert.rejects(t.api.resendSignupCode('a@b.co'), (e: unknown) => e instanceof ApiError && e.retryAfterSeconds === 42);
  });

  it('401 com token avisa a sessão; 401 de login (sem token) não', async () => {
    const body = { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida' } };
    const t = setup({ status: 401, body });
    await assert.rejects(t.api.me());
    assert.equal(t.unauthorizedCount(), 1);
    await assert.rejects(t.api.login('x', 'y'));
    assert.equal(t.unauthorizedCount(), 1);
    t.setToken(undefined);
    await assert.rejects(t.api.me());
    assert.equal(t.unauthorizedCount(), 1);
  });

  it('falha de rede vira NETWORK; erro do servidor não vaza a mensagem interna', async () => {
    const down = setup({ throws: true });
    await assert.rejects(down.api.me(), (e: unknown) => e instanceof ApiError && e.code === 'NETWORK');

    const broken = setup({ status: 500, body: { error: { code: 'INTERNAL', message: 'stack trace secreto' } } });
    await assert.rejects(broken.api.me(), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, 'INTERNAL');
      assert.ok(!e.message.includes('secreto'));
      return true;
    });
  });

  it('resposta de erro sem JSON válido ainda gera um ApiError pelo status', async () => {
    const t = setup({ status: 404, badJson: true });
    await assert.rejects(t.api.getProfile('x'), (e: unknown) => e instanceof ApiError && e.code === 'NOT_FOUND');
    const odd = setup({ status: 409, body: { error: { code: 'ESTRANHO', message: 'x' } } });
    await assert.rejects(odd.api.me(), (e: unknown) => e instanceof ApiError && e.code === 'CONFLICT');
  });
});
