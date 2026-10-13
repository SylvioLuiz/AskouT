import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Hs256TokenService, ScryptPasswordHasher } from './adapters/crypto.ts';

const fastHasher = new ScryptPasswordHasher({ N: 2 ** 10 });
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';

test('senha: hash e verificação com o custo padrão', async () => {
  const hasher = new ScryptPasswordHasher();
  const stored = await hasher.hash('uma-senha-forte-123');
  assert.match(stored, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await hasher.verify('uma-senha-forte-123', stored), true);
  assert.equal(await hasher.verify('outra-senha-123', stored), false);
});

test('senha: sal diferente a cada hash e a senha não aparece no resultado', async () => {
  const a = await fastHasher.hash('uma-senha-forte-123');
  const b = await fastHasher.hash('uma-senha-forte-123');
  assert.notEqual(a, b);
  assert.ok(!a.includes('uma-senha-forte-123'));
  assert.equal(await fastHasher.verify('uma-senha-forte-123', b), true);
});

test('senha: verifica com os parâmetros guardados no próprio hash', async () => {
  const stored = await new ScryptPasswordHasher({ N: 2 ** 11 }).hash('abc-def-123');
  assert.equal(await fastHasher.verify('abc-def-123', stored), true);
});

test('senha: normalização NFKC torna formas equivalentes iguais', async () => {
  const stored = await fastHasher.hash('ｓｅｎｈａ-forte-1'); // letras de largura total
  assert.equal(await fastHasher.verify('senha-forte-1', stored), true);
});

test('senha: hashes malformados ou adulterados são rejeitados sem lançar erro', async () => {
  const stored = await fastHasher.hash('uma-senha-forte-123');
  const parts = stored.split('$');
  const bad = [
    '',
    'lixo',
    'bcrypt$10$a$b$c$d',
    `scrypt$${2 ** 25}$8$1$${parts[4]}$${parts[5]}`, // custo absurdo
    `scrypt$1000$8$1$${parts[4]}$${parts[5]}`, // N não é potência de 2
    `scrypt$1024$8$1$$${parts[5]}`, // sem sal
    `scrypt$1024$8$1$${parts[4]}$AAAA`, // chave curta
  ];
  for (const s of bad) assert.equal(await fastHasher.verify('uma-senha-forte-123', s), false, s);
});

test('token: emite e valida', () => {
  const tokens = new Hs256TokenService({ secret: SECRET });
  const token = tokens.issue({ userId: 'u1', role: 'ADMIN' });
  assert.equal(token.split('.').length, 3);
  assert.deepEqual(tokens.verify(token), { userId: 'u1', role: 'ADMIN' });
});

test('token: expira após o TTL', () => {
  let now = Date.parse('2026-10-13T12:00:00Z');
  const tokens = new Hs256TokenService({ secret: SECRET, ttlSeconds: 60, nowMs: () => now });
  const token = tokens.issue({ userId: 'u1', role: 'USER' });
  now += 59_000;
  assert.ok(tokens.verify(token));
  now += 1_000;
  assert.equal(tokens.verify(token), undefined);
});

test('token: assinatura adulterada, payload trocado e segredo errado falham', () => {
  const tokens = new Hs256TokenService({ secret: SECRET });
  const token = tokens.issue({ userId: 'u1', role: 'USER' });
  const [h, p, s] = token.split('.') as [string, string, string];

  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'u1', role: 'ADMIN', iat: 0, exp: 9_999_999_999 }),
  ).toString('base64url');
  assert.equal(tokens.verify(`${h}.${forgedPayload}.${s}`), undefined, 'payload trocado');
  assert.equal(tokens.verify(`${h}.${p}.${s.slice(0, -2)}AA`), undefined, 'assinatura alterada');

  const other = new Hs256TokenService({ secret: 'outro-segredo-com-mais-de-32-caracteres-x' });
  assert.equal(other.verify(token), undefined, 'segredo errado');
});

test('token: alg=none e cabeçalhos diferentes são recusados', () => {
  const tokens = new Hs256TokenService({ secret: SECRET });
  const payload = Buffer.from(
    JSON.stringify({ sub: 'u1', role: 'ADMIN', iat: 0, exp: 9_999_999_999 }),
  ).toString('base64url');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(tokens.verify(`${none}.${payload}.`), undefined);
  const hs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
  assert.equal(tokens.verify(`${hs512}.${payload}.abc`), undefined);
});

test('token: o algoritmo é fixo mesmo com assinatura correta e cabeçalho diferente', () => {
  const tokens = new Hs256TokenService({ secret: SECRET });
  const payload = Buffer.from(
    JSON.stringify({ sub: 'u1', role: 'USER', iat: 0, exp: 9_999_999_999 }),
  ).toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
  const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  assert.equal(tokens.verify(`${header}.${payload}.${signature}`), undefined);

  // controle: com o cabeçalho que emitimos, a mesma assinatura vale
  const ok = tokens.issue({ userId: 'u1', role: 'USER' });
  assert.ok(tokens.verify(ok));
});

test('token: lixo e papel inválido retornam undefined', () => {
  const tokens = new Hs256TokenService({ secret: SECRET });
  for (const t of ['', 'a.b', 'a.b.c.d', 'não-é-token', '...']) assert.equal(tokens.verify(t), undefined, t);
  assert.equal(tokens.verify(undefined as unknown as string), undefined);

  const token = tokens.issue({ userId: 'u1', role: 'USER' });
  const [h, , s] = token.split('.') as [string, string, string];
  const badRole = Buffer.from(JSON.stringify({ sub: 'u1', role: 'ROOT', iat: 0, exp: 9_999_999_999 })).toString(
    'base64url',
  );
  assert.equal(tokens.verify(`${h}.${badRole}.${s}`), undefined);
});

test('token: segredo curto é recusado na criação', () => {
  assert.throws(() => new Hs256TokenService({ secret: 'curto' }));
});
