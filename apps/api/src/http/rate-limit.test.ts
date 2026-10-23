import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError } from '../core/errors.ts';
import { describeError } from './support/error-mapping.ts';
import { loadConfig } from './support/config.ts';
import { RateLimiter } from './support/rate-limiter.ts';
import { RateLimitPolicy, AUTH_PER_IP, GENERAL, GUESS_PER_ACCOUNT, MAIL_PER_ACCOUNT } from './support/rate-limit-policy.ts';

const env = { DATABASE_URL: 'postgresql://u:p@localhost:5432/askout', JWT_SECRET: 'j'.repeat(40), CODE_SECRET: 'c'.repeat(40) };

function guard() {
  const g = new RateLimitPolicy();
  let t = 1_000_000;
  g.now = () => t;
  return { g, advance: (ms: number) => { t += ms; } };
}

function blocked(fn: () => void): DomainError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof DomainError);
    assert.equal(e.code, 'RATE_LIMITED');
    return e;
  }
  throw new Error('deveria ter sido recusado');
}

describe('RateLimiter', () => {
  it('deixa passar até o limite e depois recusa com o tempo de espera', () => {
    const l = new RateLimiter();
    for (let i = 0; i < 3; i++) assert.equal(l.hit('k', 3, 10_000, 1000 + i).allowed, true);
    const v = l.hit('k', 3, 10_000, 5000);
    assert.equal(v.allowed, false);
    assert.equal(v.retryAfterSeconds, 6); // a mais antiga (1000) sai da janela em 11000
    assert.equal(l.hit('k', 3, 10_000, 11_001).allowed, true);
  });

  it('chaves diferentes não se misturam e tentativa recusada não prolonga o bloqueio', () => {
    const l = new RateLimiter();
    assert.equal(l.hit('a', 1, 1000, 0).allowed, true);
    assert.equal(l.hit('b', 1, 1000, 0).allowed, true);
    for (let i = 1; i < 50; i++) assert.equal(l.hit('a', 1, 1000, i).allowed, false);
    assert.equal(l.hit('a', 1, 1000, 1001).allowed, true);
  });
});

describe('RateLimitPolicy', () => {
  it('limite geral por IP', () => {
    const { g } = guard();
    for (let i = 0; i < GENERAL.limit; i++) g.check({ method: 'GET', path: '/explore', ip: '1.1.1.1' });
    blocked(() => g.check({ method: 'GET', path: '/explore', ip: '1.1.1.1' }));
    g.check({ method: 'GET', path: '/explore', ip: '2.2.2.2' });
  });

  it('rotas de entrada têm limite por IP bem menor', () => {
    const { g, advance } = guard();
    for (let i = 0; i < AUTH_PER_IP.limit; i++) g.check({ method: 'POST', path: '/auth/social', ip: '1.1.1.1', body: {} });
    const e = blocked(() => g.check({ method: 'POST', path: '/auth/social', ip: '1.1.1.1', body: {} }));
    const r = describeError(e);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers['Retry-After']) > 0);
    g.check({ method: 'GET', path: '/explore', ip: '1.1.1.1' });
    advance(AUTH_PER_IP.windowMs + 1000);
    g.check({ method: 'POST', path: '/auth/social', ip: '1.1.1.1', body: {} });
  });

  it('adivinhar senha de uma conta é barrado mesmo trocando de IP, sem diferenciar maiúsculas', () => {
    const { g } = guard();
    for (let i = 0; i < GUESS_PER_ACCOUNT.limit; i++) g.check({ method: 'POST', path: '/auth/login', ip: `9.9.9.${i}`, body: { identifier: i % 2 ? 'Ana@x.com ' : 'ana@x.com', password: 'x' } });
    blocked(() => g.check({ method: 'POST', path: '/auth/login', ip: '8.8.8.8', body: { identifier: 'ANA@x.com', password: 'x' } }));
    g.check({ method: 'POST', path: '/auth/login', ip: '8.8.8.8', body: { identifier: 'bia@x.com', password: 'x' } });
  });

  it('pedidos de código por e-mail são limitados por conta', () => {
    const { g } = guard();
    for (let i = 0; i < MAIL_PER_ACCOUNT.limit; i++) g.check({ method: 'POST', path: '/auth/signup/resend', ip: `7.7.7.${i}`, body: { email: 'ana@x.com' } });
    blocked(() => g.check({ method: 'POST', path: '/auth/signup/resend', ip: '6.6.6.6', body: { email: 'ana@x.com' } }));
  });

  it('corpo estranho não quebra e ignora barra final e query', () => {
    const { g } = guard();
    g.check({ method: 'POST', path: '/auth/login/', ip: '1.1.1.1', body: 'texto' });
    g.check({ method: 'POST', url: '/auth/login?x=1', ip: '1.1.1.1', body: null });
    g.check({ method: 'POST', path: '/auth/login', ip: '1.1.1.1', body: { identifier: 42 } });
  });

  it('só desliga fora de produção', () => {
    assert.equal(loadConfig(env).rateLimitEnabled, true);
    assert.equal(loadConfig({ ...env, RATE_LIMIT: 'off' }).rateLimitEnabled, false);
    assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production', RATE_LIMIT: 'off' }), /RATE_LIMIT=off/);
  });

  it('proxy confiável: padrão 1 em produção e 0 no resto, e valida o valor', () => {
    assert.equal(loadConfig(env).trustProxyHops, 0);
    assert.equal(loadConfig({ ...env, TRUST_PROXY_HOPS: '2' }).trustProxyHops, 2);
    assert.throws(() => loadConfig({ ...env, TRUST_PROXY_HOPS: 'x' }), /TRUST_PROXY_HOPS/);
  });
});
