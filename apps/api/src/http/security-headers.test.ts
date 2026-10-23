import assert from 'node:assert/strict';
import { test } from 'node:test';
import { securityHeaders } from './support/security-headers.ts';

function run(production: boolean) {
  const headers = new Map<string, string>();
  let called = false;
  securityHeaders({ production })({}, { setHeader: (k: string, v: string) => headers.set(k, v) }, () => { called = true; });
  return { headers, called };
}

test('cabeçalhos de segurança: básicos sempre; HSTS só em produção', () => {
  const dev = run(false);
  assert.equal(dev.called, true);
  assert.equal(dev.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(dev.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(dev.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(dev.headers.has('Strict-Transport-Security'), false);
  assert.match(run(true).headers.get('Strict-Transport-Security') ?? '', /^max-age=\d+$/);
});
