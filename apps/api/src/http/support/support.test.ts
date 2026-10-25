import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { DomainError, rateLimited, validationError, notFound, conflict, forbidden, unauthorized } from '../../core/errors.ts';
import { generateVapidKeys } from '../../infra/push/web-push-sender.ts';
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

  it('Resend: exige chave e remetente, e em produção libera o envio real', () => {
    const resend = { ...good, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_abc12345xyz', EMAIL_FROM: 'AskouT <nao-responda@exemplo.com.br>' };
    const cfg = loadConfig(resend);
    assert.equal(cfg.emailTransport, 'resend');
    assert.deepEqual(cfg.resend, { apiKey: 're_abc12345xyz', from: 'AskouT <nao-responda@exemplo.com.br>', replyTo: undefined });
    assert.equal(loadConfig({ ...resend, EMAIL_FROM: 'nao-responda@exemplo.com.br', EMAIL_REPLY_TO: 'ajuda@exemplo.com.br' }).resend?.replyTo, 'ajuda@exemplo.com.br');
    assert.equal(loadConfig({ ...resend, NODE_ENV: 'production' }).emailTransport, 'resend');
    assert.throws(() => loadConfig({ ...resend, RESEND_API_KEY: '' }), /RESEND_API_KEY/);
    assert.throws(() => loadConfig({ ...resend, EMAIL_FROM: 'sem-arroba' }), /EMAIL_FROM/);
    assert.throws(() => loadConfig({ ...resend, EMAIL_REPLY_TO: 'x' }), /EMAIL_REPLY_TO/);
  });

  it('chaves VAPID: opcionais, devem vir em par e combinar', () => {
    const keys = generateVapidKeys();
    assert.equal(loadConfig(good).vapid, undefined);
    assert.deepEqual(loadConfig({ ...good, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }).vapid?.publicKey, keys.publicKey);
    assert.throws(() => loadConfig({ ...good, VAPID_PUBLIC_KEY: keys.publicKey }), /juntas/);
    assert.throws(() => loadConfig({ ...good, VAPID_PUBLIC_KEY: generateVapidKeys().publicKey, VAPID_PRIVATE_KEY: keys.privateKey }), /não corresponde/);
    assert.throws(() => loadConfig({ ...good, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'ftp://x' }), /VAPID_SUBJECT/);
  });

  it('chaves APNs (aviso no iPhone): opcionais, em conjunto e com .p8 válida', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const apns = { APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: '359NDWACC5', APNS_PRIVATE_KEY: pem };
    assert.equal(loadConfig(good).apns, undefined);
    assert.deepEqual({ ...loadConfig({ ...good, ...apns }).apns, privateKey: '' }, { keyId: 'ABC123DEFG', teamId: '359NDWACC5', privateKey: '', bundleId: 'br.com.askout', production: true });
    assert.equal(loadConfig({ ...good, ...apns, APNS_PRIVATE_KEY: pem.trim().replace(/\n/g, '\\n') }).apns?.keyId, 'ABC123DEFG', 'aceita \\n literal numa linha só');
    assert.equal(loadConfig({ ...good, ...apns, APNS_ENVIRONMENT: 'sandbox' }).apns?.production, false);
    assert.throws(() => loadConfig({ ...good, APNS_KEY_ID: 'ABC123DEFG' }), /juntas/);
    assert.throws(() => loadConfig({ ...good, ...apns, APNS_KEY_ID: 'curta' }), /APNS_KEY_ID/);
    assert.throws(() => loadConfig({ ...good, ...apns, APNS_PRIVATE_KEY: 'lixo' }), /\.p8/);
    assert.throws(() => loadConfig({ ...good, ...apns, APNS_ENVIRONMENT: 'teste' }), /APNS_ENVIRONMENT/);
  });

  it('pagamento: teste ligado por padrão fora de produção; produção recusa o teste e exige provedor real', () => {
    assert.equal(loadConfig(good).paymentProvider, 'sandbox');
    assert.equal(loadConfig(good).boostPricePerDayCents, undefined, 'sem a variável valem os pacotes com desconto');
    assert.throws(() => loadConfig({ ...good, PAYMENT_PROVIDER: 'outro' }), /PAYMENT_PROVIDER/);
    assert.throws(() => loadConfig({ ...good, NODE_ENV: 'production', PAYMENT_PROVIDER: 'sandbox' }), /produção/);
    assert.throws(() => loadConfig({ ...good, BOOST_PRICE_PER_DAY_CENTS: '5' }), /BOOST_PRICE_PER_DAY_CENTS/);
    assert.equal(loadConfig({ ...good, BOOST_PRICE_PER_DAY_CENTS: '2500' }).boostPricePerDayCents, 2500);
  });

  it('pagamentos vêm DESLIGADOS por padrão e só ligam com um provedor configurado', () => {
    assert.equal(loadConfig(good).paymentsEnabled, false);
    assert.equal(loadConfig({ ...good, PAYMENTS_ENABLED: 'false' }).paymentsEnabled, false);
    // Em desenvolvimento o teste sem dinheiro já existe, então ligar basta.
    assert.equal(loadConfig({ ...good, PAYMENTS_ENABLED: 'true' }).paymentsEnabled, true);
    assert.throws(() => loadConfig({ ...good, PAYMENTS_ENABLED: 'talvez' }), /PAYMENTS_ENABLED deve ser/);
    // Em produção sem provedor, ligar é recusado (senão o app prometeria cobrar sem conseguir).
    const prod = { ...good, NODE_ENV: 'production', EMAIL_TRANSPORT: 'console' };
    assert.throws(() => loadConfig({ ...prod, PAYMENTS_ENABLED: 'true' }), /PAYMENTS_ENABLED=true exige/);
  });

  it('Stripe: exige chaves e site, e em produção só a chave real e https', () => {
    const stripe = { ...good, PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: 'whsec_abc123', PUBLIC_WEB_URL: 'https://askout.com.br' };
    const cfg = loadConfig(stripe);
    assert.equal(cfg.paymentProvider, 'stripe');
    assert.deepEqual(cfg.stripe, { secretKey: 'sk_test_abc123', webhookSecret: 'whsec_abc123', webBaseUrl: 'https://askout.com.br' });
    assert.throws(() => loadConfig({ ...good, PAYMENT_PROVIDER: 'stripe' }), /STRIPE_SECRET_KEY/);
    assert.throws(() => loadConfig({ ...stripe, STRIPE_SECRET_KEY: 'chave-qualquer' }), /STRIPE_SECRET_KEY/);
    assert.throws(() => loadConfig({ ...stripe, STRIPE_WEBHOOK_SECRET: 'x' }), /STRIPE_WEBHOOK_SECRET/);
    assert.throws(() => loadConfig({ ...stripe, PUBLIC_WEB_URL: 'askout.com.br' }), /PUBLIC_WEB_URL/);
    assert.throws(() => loadConfig({ ...stripe, PUBLIC_WEB_URL: 'https://askout.com.br/' }), /PUBLIC_WEB_URL/);
    // Produção também exige o resto da configuração (e-mail real), então só conferimos as mensagens da Stripe.
    const prod = (extra: Record<string, string>) => () => loadConfig({ ...stripe, NODE_ENV: 'production', ...extra });
    assert.throws(prod({}), /sk_live_/);
    assert.throws(prod({ STRIPE_SECRET_KEY: 'sk_live_abc123', PUBLIC_WEB_URL: 'http://askout.com.br' }), /precisa ser https/);
  });

  it('preço na loja: igual ao da web se não for informado', () => {
    // Sem valor próprio da loja, o serviço usa o mesmo da web (pacotes com desconto, ou dias × valor configurado).
    assert.equal(loadConfig(good).boostStorePricePerDayCents, undefined);
    assert.equal(loadConfig({ ...good, BOOST_PRICE_PER_DAY_CENTS: '2000' }).boostStorePricePerDayCents, undefined);
    assert.equal(loadConfig({ ...good, BOOST_STORE_PRICE_PER_DAY_CENTS: '2200' }).boostStorePricePerDayCents, 2200);
    assert.throws(() => loadConfig({ ...good, BOOST_STORE_PRICE_PER_DAY_CENTS: '1' }), /BOOST_STORE_PRICE_PER_DAY_CENTS/);
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
