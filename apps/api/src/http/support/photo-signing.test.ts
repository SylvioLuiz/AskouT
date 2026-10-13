import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhotoSigner } from './photo-signing.ts';
import { loadConfig } from './config.ts';

const REF = 'places/ChIJ1/photos/AbC_d-1';
function parts(path: string) {
  const q = new URL(path, 'http://x').searchParams;
  return { ref: q.get('ref')!, exp: q.get('exp')!, sig: q.get('sig')! };
}

test('endereço assinado vale para a foto certa, dentro da validade', () => {
  let t = 1_000_000;
  const s = new PhotoSigner('segredo-com-mais-de-32-caracteres-aqui', () => t);
  const p = parts(s.path(REF));
  assert.equal(s.verify(p.ref, p.exp, p.sig), true);
  assert.equal(s.verify('places/OUTRA/photos/x', p.exp, p.sig), false, 'outra foto');
  assert.equal(s.verify(p.ref, String(Number(p.exp) + 1000), p.sig), false, 'validade adulterada');
  assert.equal(s.verify(p.ref, p.exp, p.sig.slice(0, -2) + 'AA'), false, 'assinatura adulterada');
  assert.equal(s.verify(p.ref, p.exp, ''), false);
  assert.equal(s.verify(p.ref, 'abc', p.sig), false);
  t += 31 * 60_000;
  assert.equal(s.verify(p.ref, p.exp, p.sig), false, 'vencido');
  assert.equal(new PhotoSigner('outro-segredo-com-mais-de-32-caracteres', () => 1_000_000).verify(p.ref, p.exp, p.sig), false, 'outro segredo');
});

test('config: Google é opcional e o teto diário é validado', () => {
  const good = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'a'.repeat(32), CODE_SECRET: 'b'.repeat(32) };
  const c = loadConfig(good);
  assert.equal(c.googlePlacesKey, undefined);
  assert.equal(c.googleDailyLimit, 500);
  assert.equal(loadConfig({ ...good, GOOGLE_PLACES_API_KEY: ' k ', GOOGLE_DAILY_LIMIT: '50' }).googlePlacesKey, 'k');
  assert.throws(() => loadConfig({ ...good, GOOGLE_DAILY_LIMIT: '0' }), /GOOGLE_DAILY_LIMIT/);
});
