import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { OidcIdentityVerifier } from './oidc-verifier.ts';

const NOW = new Date('2026-10-18T12:00:00Z');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256' };

function token(payload: object, opts: { key?: typeof privateKey; kid?: string; alg?: string } = {}): string {
  const h = Buffer.from(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), opts.key ?? privateKey).toString('base64url')}`;
}

const good = { iss: 'https://accounts.google.com', aud: 'cli-google', sub: '123', exp: NOW.getTime() / 1000 + 600, email: 'ana@exemplo.com', email_verified: true, name: 'Ana' };

function make(fetches: { n: number } = { n: 0 }) {
  return new OidcIdentityVerifier({ googleClientId: 'cli-google', appleClientId: 'cli-apple', now: () => NOW, fetchJson: async () => { fetches.n += 1; return { keys: [jwk] }; } });
}

test('aceita token válido do Google e devolve o que a plataforma garante', async () => {
  const claims = await make().verify('GOOGLE', token(good));
  assert.deepEqual(claims, { subject: '123', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana' });
});

test('recusa assinatura falsa, aplicativo errado, emissor errado, expirado e algoritmo diferente', async () => {
  const v = make();
  assert.equal(await v.verify('GOOGLE', token(good, { key: other.privateKey })), undefined, 'assinada por outra chave');
  assert.equal(await v.verify('GOOGLE', token({ ...good, aud: 'outro-app' })), undefined, 'feito para outro aplicativo');
  assert.equal(await v.verify('GOOGLE', token({ ...good, iss: 'https://evil.example' })), undefined, 'emissor errado');
  assert.equal(await v.verify('GOOGLE', token({ ...good, exp: NOW.getTime() / 1000 - 3600 })), undefined, 'expirado');
  assert.equal(await v.verify('GOOGLE', token(good, { alg: 'none' })), undefined, 'algoritmo diferente');
  assert.equal(await v.verify('GOOGLE', token(good, { kid: 'desconhecida' })), undefined, 'chave desconhecida');
  assert.equal(await v.verify('GOOGLE', 'lixo'), undefined);
  assert.equal(await v.verify('APPLE', token(good)), undefined, 'token do Google não vale como da Apple');
});

test('Apple: e-mail_verified como texto "true" vale; sem e-mail não é verificado', async () => {
  const v = make();
  const apple = { ...good, iss: 'https://appleid.apple.com', aud: 'cli-apple', email_verified: 'true' };
  assert.equal((await v.verify('APPLE', token(apple)))?.emailVerified, true);
  const noEmail = { ...apple, email: undefined };
  assert.deepEqual(await v.verify('APPLE', token(noEmail)), { subject: '123', email: null, emailVerified: false, name: 'Ana' });
});

test('sem ID do aplicativo configurado, a plataforma fica desligada; chaves ficam em cache', async () => {
  const fetches = { n: 0 };
  const only = new OidcIdentityVerifier({ googleClientId: 'cli-google', now: () => NOW, fetchJson: async () => { fetches.n += 1; return { keys: [jwk] }; } });
  assert.deepEqual(only.providers(), [{ provider: 'GOOGLE', clientId: 'cli-google' }]);
  assert.equal(await only.verify('APPLE', token(good)), undefined);
  await only.verify('GOOGLE', token(good));
  await only.verify('GOOGLE', token(good));
  assert.equal(fetches.n, 1);
});
