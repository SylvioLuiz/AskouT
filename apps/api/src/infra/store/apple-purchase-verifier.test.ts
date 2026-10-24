import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate, createPrivateKey, sign } from 'node:crypto';
import { AppleJwsPurchaseVerifier } from './apple-purchase-verifier.ts';

const ossl = (args: string[], cwd: string) => execFileSync('openssl', args, { cwd, stdio: 'pipe' });

/** Cadeia de mentira (raiz → intermediária → folha) gerada com o openssl, no lugar da cadeia da Apple. */
function makeChain(name = 'a') {
  const dir = mkdtempSync(join(tmpdir(), `apple-${name}-`));
  for (const n of ['root', 'inter', 'leaf']) ossl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${n}.key`], dir);
  ossl(['req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Raiz de teste', '-days', '30', '-out', 'root.pem'], dir);
  for (const [n, issuer] of [['inter', 'root'], ['leaf', 'inter']] as const) {
    ossl(['req', '-new', '-key', `${n}.key`, '-subj', `/CN=${n} de teste`, '-out', `${n}.csr`], dir);
    ossl(['x509', '-req', '-in', `${n}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', '30', '-out', `${n}.pem`], dir);
  }
  const der = (f: string) => new X509Certificate(readFileSync(join(dir, f))).raw.toString('base64');
  return { x5c: [der('leaf.pem'), der('inter.pem'), der('root.pem')], leafKey: createPrivateKey(readFileSync(join(dir, 'leaf.key'))), rootFp: new X509Certificate(readFileSync(join(dir, 'root.pem'))).fingerprint256, dir };
}

const chain = makeChain();

function jws(payload: object, c = chain, x5c = c.x5c): string {
  const h = Buffer.from(JSON.stringify({ alg: 'ES256', x5c })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${sign('SHA256', Buffer.from(`${h}.${p}`), { key: c.leafKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

const tx = { bundleId: 'br.com.askout', productId: 'askout.boost.3d', transactionId: '2000001', environment: 'Production' };
const verifier = (over: object = {}) => new AppleJwsPurchaseVerifier({ bundleId: 'br.com.askout', rootFingerprint: chain.rootFp, ...over });

test('aceita transação assinada por cadeia confiável e devolve produto e transação', async () => {
  assert.deepEqual(await verifier().verify({ store: 'APPLE', receipt: jws(tx) }), { productId: 'askout.boost.3d', transactionId: '2000001', active: true });
});

test('transação devolvida (revocationDate) vem como inativa', async () => {
  const r = await verifier().verify({ store: 'APPLE', receipt: jws({ ...tx, revocationDate: 1_700_000_000_000 }) });
  assert.equal(r?.active, false);
});

test('recusa: outro app, outra raiz, assinatura trocada, Google, lixo e ambiente de teste quando desligado', async () => {
  const v = verifier();
  assert.equal(await v.verify({ store: 'APPLE', receipt: jws({ ...tx, bundleId: 'outro.app' }) }), undefined, 'bundle id de outro app');
  assert.equal(await verifier({ rootFingerprint: 'AA:BB' }).verify({ store: 'APPLE', receipt: jws(tx) }), undefined, 'raiz que não é a configurada');
  const other = makeChain('b');
  assert.equal(await v.verify({ store: 'APPLE', receipt: jws(tx, other) }), undefined, 'cadeia de outra raiz (forjada)');
  const forged = jws(tx).split('.');
  forged[1] = Buffer.from(JSON.stringify({ ...tx, productId: 'askout.boost.14d' })).toString('base64url');
  assert.equal(await v.verify({ store: 'APPLE', receipt: forged.join('.') }), undefined, 'conteúdo alterado depois de assinar');
  assert.equal(await v.verify({ store: 'GOOGLE', receipt: jws(tx) }), undefined, 'Google não é conferido aqui');
  assert.equal(await v.verify({ store: 'APPLE', receipt: 'lixo' }), undefined);
  assert.equal(await v.verify({ store: 'APPLE', receipt: jws({ ...tx, environment: 'Sandbox' }) }) !== undefined, true, 'Sandbox vale por padrão');
  assert.equal(await verifier({ acceptSandbox: false }).verify({ store: 'APPLE', receipt: jws({ ...tx, environment: 'Sandbox' }) }), undefined, 'Sandbox desligado');
});

test('recusa cadeia vencida', async () => {
  const later = new AppleJwsPurchaseVerifier({ bundleId: 'br.com.askout', rootFingerprint: chain.rootFp, now: () => new Date(Date.now() + 90 * 86_400_000) });
  assert.equal(await later.verify({ store: 'APPLE', receipt: jws(tx) }), undefined);
});
