import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { describe, it } from 'node:test';
import { encryptPayload, generateVapidKeys, vapidAuthorization, vapidKeysMatch, WebPushSender } from './web-push-sender.ts';

const b64 = (s: string) => Buffer.from(s, 'base64url');

describe('Web Push', () => {
  it('cifra igual ao exemplo oficial do RFC 8291 (apêndice A)', () => {
    const body = encryptPayload(Buffer.from('When I grow up, I want to be a watermelon'), 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', {
      salt: b64('DGv6ra1nlYgDCS1FRnbzlw'),
      ephemeralPrivateKey: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
    });
    assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });

  it('o navegador consegue decifrar o que o servidor cifrou (ida e volta)', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const text = Buffer.from(JSON.stringify({ title: 'Olá ç ã', body: 'x'.repeat(300) }));
    const body = encryptPayload(text, ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
    const salt = body.subarray(0, 16);
    assert.equal(body.readUInt32BE(16), 4096);
    const idlen = body[20]!;
    const asPublic = body.subarray(21, 21 + idlen);
    const cipherText = body.subarray(21 + idlen);
    const shared = ua.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(cipherText.subarray(cipherText.length - 16));
    const plain = Buffer.concat([d.update(cipherText.subarray(0, cipherText.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2);
    assert.equal(plain.subarray(0, plain.length - 1).toString(), text.toString());
  });

  it('recusa chaves e conteúdo inválidos', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const pub = ua.getPublicKey().toString('base64url');
    assert.throws(() => encryptPayload(Buffer.from('x'), 'AAAA', 'AAAAAAAAAAAAAAAAAAAAAA'));
    assert.throws(() => encryptPayload(Buffer.from('x'), pub, 'AAAA'));
    assert.throws(() => encryptPayload(Buffer.alloc(5000), pub, 'AAAAAAAAAAAAAAAAAAAAAA'));
  });

  it('VAPID: o JWT assina com a chave privada e a pública confere a assinatura', () => {
    const keys = generateVapidKeys();
    assert.equal(vapidKeysMatch(keys), true);
    assert.equal(vapidKeysMatch({ publicKey: generateVapidKeys().publicKey, privateKey: keys.privateKey }), false);
    assert.equal(vapidKeysMatch({ publicKey: 'x', privateKey: 'y' }), false);
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:contato@exemplo.com', 1_700_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    assert.ok(m, header);
    assert.equal(m![4], keys.publicKey);
    const claims = JSON.parse(Buffer.from(m![2]!, 'base64url').toString());
    assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 43200, sub: 'mailto:contato@exemplo.com' });
    const pub = b64(keys.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') }, format: 'jwk' });
    assert.equal(verify('sha256', Buffer.from(`${m![1]}.${m![2]}`), { key, dsaEncoding: 'ieee-p1363' }, b64(m![3]!)), true);
  });

  it('envia com os cabeçalhos certos e traduz as respostas', async () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const sub = { userId: 'u', endpoint: 'https://push.example/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url'), createdAt: new Date() };
    const msg = { title: 'T', body: 'B', url: '/x', tag: 't' };
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const sender = new WebPushSender({ keys: generateVapidKeys(), subject: 'mailto:a@b.c', nowMs: () => 1_700_000_000_000, fetchImpl: (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status }); }) as unknown as typeof fetch });
    assert.equal(await sender.send(sub, msg), 'SENT');
    const headers = seen[0]!.init.headers as Record<string, string>;
    assert.equal(headers['Content-Encoding'], 'aes128gcm');
    assert.ok(headers['TTL']);
    assert.match(headers['Authorization']!, /^vapid t=.+, k=.+$/);
    assert.equal(seen[0]!.url, 'https://push.example/abc');
    status = 410;
    assert.equal(await sender.send(sub, msg), 'GONE');
    status = 404;
    assert.equal(await sender.send(sub, msg), 'GONE');
    status = 500;
    assert.equal(await sender.send(sub, msg), 'FAILED');
    assert.equal(await sender.send({ ...sub, p256dh: 'ruim' }, msg), 'FAILED');
  });
});
