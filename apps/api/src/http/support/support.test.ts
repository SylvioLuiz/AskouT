import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError, rateLimited, validationError, notFound, conflict, forbidden, unauthorized } from '../../core/errors.ts';
import { loadConfig } from './config.ts';
import { describeError } from './error-mapping.ts';
import { asBody, bearerToken, parseIntParam } from './parse.ts';

const good = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/askout',
  JWT_SECRET: 'j'.repeat(40),
  CODE_SECRET: 'c'.repeat(40),
};

describe('loadConfig', () => {
  it('aceita configuração válida e aplica padrões', () => {
    const c = loadConfig(good);
    assert.equal(c.port, 3000);
    assert.equal(c.tokenTtlSeconds, 3600);
    assert.deepEqual(c.corsOrigins, []);
    assert.equal(c.nodeEnv, 'development');
  });

  it('lista todos os problemas de uma vez', () => {
    assert.throws(
      () => loadConfig({ JWT_SECRET: 'curto', PORT: 'abc' }),
      (e: Error) => /PORT/.test(e.message) && /DATABASE_URL/.test(e.message) && /JWT_SECRET/.test(e.message) && /CODE_SECRET/.test(e.message),
    );
  });

  it('exige segredos distintos', () => {
    assert.throws(() => loadConfig({ ...good, CODE_SECRET: good.JWT_SECRET }), /diferentes/);
  });

  it('recusa e-mail "console" em produção', () => {
    assert.throws(() => loadConfig({ ...good, NODE_ENV: 'production' }), /produção/);
  });

  it('recusa transporte de e-mail desconhecido, CORS "*" e TTL absurdo', () => {
    assert.throws(() => loadConfig({ ...good, EMAIL_TRANSPORT: 'smtp' }), /EMAIL_TRANSPORT/);
    assert.throws(() => loadConfig({ ...good, CORS_ORIGINS: '*' }), /CORS_ORIGINS/);
    assert.throws(() => loadConfig({ ...good, TOKEN_TTL_SECONDS: '5' }), /TOKEN_TTL_SECONDS/);
  });

  it('lê lista de origens CORS', () => {
    assert.deepEqual(loadConfig({ ...good, CORS_ORIGINS: 'http://a.com, http://b.com ,' }).corsOrigins, ['http://a.com', 'http://b.com']);
  });
});

describe('describeError', () => {
  it('mapeia cada código de domínio para o status HTTP certo', () => {
    assert.equal(describeError(validationError('x')).status, 400);
    assert.equal(describeError(unauthorized('x')).status, 401);
    assert.equal(describeError(forbidden('x')).status, 403);
    assert.equal(describeError(notFound('x')).status, 404);
    assert.equal(describeError(conflict('x')).status, 409);
    assert.equal(describeError(rateLimited('x', 30)).status, 429);
  });

  it('envia Retry-After arredondado para cima em 429', () => {
    assert.equal(describeError(rateLimited('x', 29.2)).headers['Retry-After'], '30');
    assert.deepEqual(describeError(rateLimited('x')).headers, {});
  });

  it('inclui details só quando existem', () => {
    const r = describeError(new DomainError('VALIDATION', 'm', { username: 'ruim' }));
    assert.deepEqual(r.body.error.details, { username: 'ruim' });
    assert.equal('details' in describeError(notFound('x')).body.error, false);
  });

  it('erro inesperado vira 500 genérico, sem vazar a mensagem', () => {
    const r = describeError(new Error('senha do banco: hunter2'));
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, 'INTERNAL');
    assert.equal(JSON.stringify(r).includes('hunter2'), false);
  });

  it('erros do framework/parser mantêm o status 4xx, mas com mensagem própria', () => {
    const parser = Object.assign(new Error('Unexpected token < in JSON'), { status: 400 });
    const r = describeError(parser);
    assert.equal(r.status, 400);
    assert.equal(r.body.error.message.includes('JSON'), false);
    assert.equal(describeError({ getStatus: () => 404 }).body.error.code, 'NOT_FOUND');
    assert.equal(describeError(Object.assign(new Error('x'), { statusCode: 413 })).status, 413);
  });

  it('status 5xx de terceiros vira 500 genérico', () => {
    assert.equal(describeError(Object.assign(new Error('boom'), { status: 502 })).status, 500);
  });
});

describe('parse', () => {
  it('asBody devolve só objetos simples', () => {
    assert.deepEqual(asBody({ a: 1 }), { a: 1 });
    for (const bad of [null, undefined, 'x', 3, [1, 2]]) assert.deepEqual(asBody(bad), {});
  });

  it('parseIntParam aceita só inteiros não negativos curtos', () => {
    assert.equal(parseIntParam('10'), 10);
    assert.equal(parseIntParam('0'), 0);
    for (const bad of ['-1', '1.5', 'abc', '', '1e3', '9999999999', undefined, ['1']]) assert.equal(parseIntParam(bad), undefined);
  });

  it('bearerToken extrai o token e rejeita formatos estranhos', () => {
    assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.equal(bearerToken('bearer abc'), 'abc');
    assert.equal(bearerToken(['Bearer x']), 'x');
    for (const bad of [undefined, '', 'Bearer', 'Bearer a b', 'Basic abc', 42]) assert.equal(bearerToken(bad), undefined);
  });
});
