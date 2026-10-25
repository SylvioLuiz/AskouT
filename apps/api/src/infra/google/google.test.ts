import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, it } from 'node:test';
import { GoogleAccessTokens, parseServiceAccount } from './service-account.ts';
import type { FetchLike } from './service-account.ts';
import { FcmSender, NativePushRouter } from '../push/fcm-sender.ts';
import { GooglePlayPurchaseVerifier, StorePurchaseRouter } from '../store/google-play-verifier.ts';
import type { PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const creds = { client_email: 'askout@askout-1.iam.gserviceaccount.com', private_key: pem, project_id: 'askout-1' };
const json = JSON.stringify({ type: 'service_account', ...creds, token_uri: 'https://oauth2.googleapis.com/token' });
const FCM_TOKEN = 'f'.repeat(30) + ':' + 'A'.repeat(60);
const sub = (endpoint: string): PushSubscriptionRecord => ({ userId: 'u', endpoint, p256dh: 'x', auth: 'x', createdAt: new Date(0) });
const msg = { title: 'Ana', body: 'Nova mensagem', url: '/conversas/1', tag: 'MESSAGE' };
const ok = (body: unknown, status = 200): { status: number; text(): Promise<string> } => ({ status, text: async () => JSON.stringify(body) });

/** Troca de token falsa que guarda as chamadas. */
function fakeGoogle(handler: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => { status: number; text(): Promise<string> }) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string | undefined }> = [];
  let tokenCount = 0;
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenCount += 1;
      return ok({ access_token: `tok${tokenCount}`, expires_in: 3600 });
    }
    return handler(url, init);
  };
  return { fetcher, calls, tokens: new GoogleAccessTokens({ credentials: creds, fetch: fetcher, nowMs: () => 1_700_000_000_000 }) };
}

describe('Conta de serviço do Google', () => {
  it('aceita o JSON da conta de serviço e recusa o resto', () => {
    assert.equal(parseServiceAccount(json)?.project_id, 'askout-1');
    assert.equal(parseServiceAccount(json.replace(/\n/g, '\\n'))?.client_email, creds.client_email);
    assert.equal(parseServiceAccount('lixo'), undefined);
    assert.equal(parseServiceAccount(JSON.stringify({ ...creds, client_email: 'a@b.com' })), undefined);
    assert.equal(parseServiceAccount(JSON.stringify({ ...creds, token_uri: 'https://evil.example/token' })), undefined);
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    assert.equal(parseServiceAccount(JSON.stringify({ ...creds, private_key: ec })), undefined);
  });

  it('assina a assertion com RS256 e a chave da conta', () => {
    const t = new GoogleAccessTokens({ credentials: creds, fetch: async () => ok({}) });
    const jwt = t.assertion('scope-x', 1_700_000_000);
    const [h, p, s] = jwt.split('.') as [string, string, string];
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    assert.equal(payload['iss'], creds.client_email);
    assert.equal(payload['scope'], 'scope-x');
    assert.equal(payload['aud'], 'https://oauth2.googleapis.com/token');
    assert.equal(payload['exp'], 1_700_003_600);
    assert.equal(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')), true);
  });

  it('guarda o token de acesso e só pede outro quando forçado', async () => {
    const g = fakeGoogle(() => ok({}));
    assert.equal(await g.tokens.get('s'), 'tok1');
    assert.equal(await g.tokens.get('s'), 'tok1');
    assert.equal(await g.tokens.get('s', true), 'tok2');
    assert.match(g.calls[0]!.body!, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
  });

  it('falha com mensagem clara se o Google recusar a conta', async () => {
    const t = new GoogleAccessTokens({ credentials: creds, fetch: async () => ok({ error: 'invalid_grant' }, 400) });
    await assert.rejects(t.get('s'), /recusou a conta de serviço \(400\)/);
  });
});

describe('FCM (aviso no Android)', () => {
  it('monta o pedido para o FCM v1', async () => {
    const g = fakeGoogle(() => ok({ name: 'projects/askout-1/messages/1' }));
    const sender = new FcmSender({ tokens: g.tokens, fetch: g.fetcher });
    assert.equal(await sender.send(sub(`fcm:${FCM_TOKEN}`), msg), 'SENT');
    const call = g.calls.find((c) => c.url.includes('fcm.googleapis.com'))!;
    assert.equal(call.url, 'https://fcm.googleapis.com/v1/projects/askout-1/messages:send');
    assert.equal(call.headers['authorization'], 'Bearer tok1');
    const body = JSON.parse(call.body!) as { message: { token: string; notification: { title: string; body: string }; data: { url: string } } };
    assert.equal(body.message.token, FCM_TOKEN);
    assert.deepEqual(body.message.notification, { title: 'Ana', body: 'Nova mensagem' });
    assert.equal(body.message.data.url, '/conversas/1');
  });

  it('recusa endereço que não é do Android e trata token inválido como GONE', async () => {
    const g = fakeGoogle(() => ok({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, 404));
    const sender = new FcmSender({ tokens: g.tokens, fetch: g.fetcher });
    assert.equal(await sender.send(sub('apns:abc'), msg), 'FAILED');
    assert.equal(await sender.send(sub(`fcm:${FCM_TOKEN}`), msg), 'GONE');
  });

  it('renova o token de acesso se o FCM responder 401 e falha com outros erros', async () => {
    let n = 0;
    const g = fakeGoogle(() => (n++ === 0 ? ok({}, 401) : ok({}, 200)));
    assert.equal(await new FcmSender({ tokens: g.tokens, fetch: g.fetcher }).send(sub(`fcm:${FCM_TOKEN}`), msg), 'SENT');
    assert.equal(g.calls.filter((c) => c.url.includes('oauth2')).length, 2);
    const g2 = fakeGoogle(() => ok({ error: { status: 'UNAVAILABLE' } }, 503));
    assert.equal(await new FcmSender({ tokens: g2.tokens, fetch: g2.fetcher }).send(sub(`fcm:${FCM_TOKEN}`), msg), 'FAILED');
  });

  it('o roteador escolhe pelo prefixo e falha se o caminho não está configurado', async () => {
    const mark = (r: 'SENT' | 'GONE'): PushSender => ({ publicKey: null, send: async () => r });
    const router = new NativePushRouter({ apns: mark('SENT'), fcm: mark('GONE') });
    assert.equal(await router.send(sub('apns:aa'), msg), 'SENT');
    assert.equal(await router.send(sub('fcm:aa'), msg), 'GONE');
    assert.equal(await new NativePushRouter({ apns: mark('SENT') }).send(sub('fcm:aa'), msg), 'FAILED');
  });
});

describe('Compra no Google Play', () => {
  const receipt = (extra: Record<string, unknown> = {}) => JSON.stringify({ productId: 'askout.boost.3d', purchaseToken: 'tok-abcdefghij-123', ...extra });

  it('confere a compra na API do Google e devolve o pedido (orderId)', async () => {
    const g = fakeGoogle(() => ok({ purchaseState: 0, orderId: 'GPA.1234-5678', consumptionState: 1 }));
    const v = new GooglePlayPurchaseVerifier({ packageName: 'br.com.askout', tokens: g.tokens, fetch: g.fetcher });
    assert.deepEqual(await v.verify({ store: 'GOOGLE', receipt: receipt() }), { productId: 'askout.boost.3d', transactionId: 'GPA.1234-5678', active: true });
    const call = g.calls.find((c) => c.url.includes('androidpublisher'))!;
    assert.equal(call.url, 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/br.com.askout/purchases/products/askout.boost.3d/tokens/tok-abcdefghij-123');
    assert.equal(call.headers['authorization'], 'Bearer tok1');
  });

  it('compra cancelada ou pendente não libera, e recibo ruim ou erro do Google é recusado', async () => {
    const mk = (status: number, body: unknown) => {
      const g = fakeGoogle(() => ok(body, status));
      return new GooglePlayPurchaseVerifier({ packageName: 'br.com.askout', tokens: g.tokens, fetch: g.fetcher });
    };
    assert.equal((await mk(200, { purchaseState: 1, orderId: 'x' }).verify({ store: 'GOOGLE', receipt: receipt() }))?.active, false);
    assert.equal((await mk(200, { purchaseState: 2 }).verify({ store: 'GOOGLE', receipt: receipt() }))?.active, false);
    assert.equal(await mk(404, { error: {} }).verify({ store: 'GOOGLE', receipt: receipt() }), undefined);
    assert.equal(await mk(200, { purchaseState: 0 }).verify({ store: 'APPLE', receipt: receipt() }), undefined);
    for (const bad of ['lixo', '{}', receipt({ productId: '../x' }), receipt({ purchaseToken: 'curto' }), receipt({ purchaseToken: 'a/b/c/d/e/f/g/h/i/j' })]) {
      assert.equal(await mk(200, { purchaseState: 0 }).verify({ store: 'GOOGLE', receipt: bad }), undefined);
    }
  });

  it('sem orderId usa o token como identificador e o roteador separa as lojas', async () => {
    const g = fakeGoogle(() => ok({ purchaseState: 0 }));
    const google = new GooglePlayPurchaseVerifier({ packageName: 'br.com.askout', tokens: g.tokens, fetch: g.fetcher });
    assert.equal((await google.verify({ store: 'GOOGLE', receipt: receipt() }))?.transactionId, 'tok-abcdefghij-123');
    const router = new StorePurchaseRouter({ GOOGLE: google });
    assert.equal(router.supports('GOOGLE'), true);
    assert.equal(router.supports('APPLE'), false);
    assert.equal(await router.verify({ store: 'APPLE', receipt: 'x' }), undefined);
    assert.equal((await router.verify({ store: 'GOOGLE', receipt: receipt() }))?.active, true);
  });
});
