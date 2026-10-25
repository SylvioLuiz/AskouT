import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, it } from 'node:test';
import { ApnsSender, apnsKeyIsValid, apnsProviderToken, CompositePushSender } from './apns-sender.ts';
import type { ApnsRequest, ApnsResponse } from './apns-sender.ts';
import type { PushSender } from '../../core/ports.ts';
import type { PushSubscriptionRecord } from '../../core/types.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const config = { keyId: 'ABC123DEFG', teamId: '359NDWACC5', privateKey: pem, bundleId: 'br.com.askout', production: true };
const sub = (endpoint: string): PushSubscriptionRecord => ({ userId: 'u', endpoint, p256dh: 'apns', auth: 'apns', createdAt: new Date(0) });
const msg = { title: 'Ana', body: 'Nova mensagem', url: '/conversas/1', tag: 'MESSAGE' };
const TOKEN = 'a'.repeat(64);

describe('APNs (aviso no iPhone)', () => {
  it('o token de autenticação é um JWT ES256 com a equipe e a chave certas', () => {
    const jwt = apnsProviderToken(config, 1_700_000_000);
    const [h, p, s] = jwt.split('.') as [string, string, string];
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG' });
    assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), { iss: '359NDWACC5', iat: 1_700_000_000 });
    assert.equal(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
  });

  it('reconhece uma .p8 válida, inclusive com \\n literais, e recusa o resto', () => {
    assert.equal(apnsKeyIsValid(pem), true);
    assert.equal(apnsKeyIsValid(pem.trim().replace(/\n/g, '\\n')), true);
    assert.equal(apnsKeyIsValid('lixo'), false);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    assert.equal(apnsKeyIsValid(rsa), false);
  });

  it('monta o pedido para a Apple: servidor, caminho, cabeçalhos e conteúdo', async () => {
    const requests: ApnsRequest[] = [];
    const sender = new ApnsSender({ config, transport: async (r) => (requests.push(r), { status: 200, body: '' }) });
    assert.equal(await sender.send(sub(`apns:${TOKEN}`), msg), 'SENT');
    const r = requests[0]!;
    assert.equal(r.host, 'api.push.apple.com');
    assert.equal(r.path, `/3/device/${TOKEN}`);
    assert.equal(r.headers['apns-topic'], 'br.com.askout');
    assert.equal(r.headers['apns-push-type'], 'alert');
    assert.equal(r.headers['apns-collapse-id'], 'MESSAGE');
    assert.match(r.headers['authorization']!, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.deepEqual(JSON.parse(r.body), { aps: { alert: { title: 'Ana', body: 'Nova mensagem' }, sound: 'default' }, url: '/conversas/1' });
  });

  it('modo sandbox usa o servidor de testes da Apple', async () => {
    const requests: ApnsRequest[] = [];
    const sender = new ApnsSender({ config: { ...config, production: false }, transport: async (r) => (requests.push(r), { status: 200, body: '' }) });
    await sender.send(sub(`apns:${TOKEN}`), msg);
    assert.equal(requests[0]!.host, 'api.sandbox.push.apple.com');
  });

  it('token do aparelho que a Apple não aceita mais vira GONE; erro passageiro vira FAILED', async () => {
    const answer = (status: number, reason: string) => new ApnsSender({ config, transport: async () => ({ status, body: JSON.stringify({ reason }) }) });
    assert.equal(await answer(410, 'Unregistered').send(sub(`apns:${TOKEN}`), msg), 'GONE');
    assert.equal(await answer(400, 'BadDeviceToken').send(sub(`apns:${TOKEN}`), msg), 'GONE');
    assert.equal(await answer(400, 'BadTopic').send(sub(`apns:${TOKEN}`), msg), 'FAILED');
    assert.equal(await answer(503, 'ServiceUnavailable').send(sub(`apns:${TOKEN}`), msg), 'FAILED');
    const broken = new ApnsSender({ config, transport: async () => Promise.reject(new Error('rede')) });
    assert.equal(await broken.send(sub(`apns:${TOKEN}`), msg), 'FAILED');
    assert.equal(await broken.send(sub('https://web/x'), msg), 'FAILED', 'não envia inscrição de navegador pela Apple');
  });

  it('reaproveita o token por até 50 min e renova se a Apple disser que expirou', async () => {
    let now = 1_700_000_000_000;
    const auths: string[] = [];
    let first = true;
    const transport = async (r: ApnsRequest): Promise<ApnsResponse> => {
      auths.push(r.headers['authorization']!);
      if (first && auths.length === 3) {
        first = false;
        return { status: 403, body: JSON.stringify({ reason: 'ExpiredProviderToken' }) };
      }
      return { status: 200, body: '' };
    };
    const sender = new ApnsSender({ config, transport, nowMs: () => now });
    await sender.send(sub(`apns:${TOKEN}`), msg);
    now += 10 * 60_000;
    await sender.send(sub(`apns:${TOKEN}`), msg);
    assert.equal(auths[0], auths[1], 'mesmo token dentro de 50 min');
    now += 1_000;
    assert.equal(await sender.send(sub(`apns:${TOKEN}`), msg), 'SENT', 'depois de 403 expirado tenta de novo com token novo');
    assert.equal(auths.length, 4);
    assert.notEqual(auths[2], auths[3]);
  });

  it('o envio composto manda cada inscrição pelo caminho certo', async () => {
    const calls: string[] = [];
    const fake = (name: string, publicKey: string | null): PushSender => ({ publicKey, send: async () => (calls.push(name), 'SENT') });
    const both = new CompositePushSender(fake('web', 'chave'), fake('ios', null));
    assert.equal(both.publicKey, 'chave');
    assert.equal(both.nativeEnabled, true);
    await both.send(sub('https://web/x'), msg);
    await both.send(sub(`apns:${TOKEN}`), msg);
    assert.deepEqual(calls, ['web', 'ios']);
    const onlyWeb = new CompositePushSender(fake('web', null), undefined);
    assert.equal(onlyWeb.nativeEnabled, false);
    assert.equal(await onlyWeb.send(sub(`apns:${TOKEN}`), msg), 'FAILED');
  });
});
