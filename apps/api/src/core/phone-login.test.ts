import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PHONE_MAX_CODE_ATTEMPTS, PHONE_RESEND_COOLDOWN_SECONDS } from './phone-code.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';
import { totpCode, totpStep } from './totp.ts';

const PHONE = '+5511987654321';

async function setup(options: { noSms?: boolean } = {}) {
  const w = makeWorld(options);
  const u = await w.signUpMany('ana');
  const ana = u['ana']!;
  const nextCode = (secret: string) => {
    w.clock.tick(30_000);
    return totpCode(secret, totpStep(w.clock.now()));
  };
  async function enableMfa() {
    const info = await w.core.auth.mfa.setup(ana);
    const { recoveryCodes } = await w.core.auth.mfa.enable(ana, nextCode(info.secret));
    return { secret: info.secret, recoveryCodes };
  }
  return { w, ana, nextCode, enableMfa };
}

// ---------- Celular, depois o código do app autenticador ----------

async function phoneChallenge(w: Awaited<ReturnType<typeof setup>>['w'], phone: string) {
  const challenge = await w.core.auth.startPhoneAuthenticatorLogin(phone);
  assert.equal(challenge.mfaRequired, true);
  return challenge.mfaToken;
}

test('celular: etapa 1 só devolve o desafio (não é sessão); etapa 2 com o código do app entra', async () => {
  const { w, ana, nextCode, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, '(11) 98765-4321');
  const { secret } = await enableMfa();
  const token = await phoneChallenge(w, '11 98765 4321');
  await rejectsWith(w.core.auth.authenticate(token), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: token, code: '000000' }), 'VALIDATION');
  const session = await w.core.auth.verifyMfaLogin({ mfaToken: token, code: nextCode(secret) });
  assert.equal(session.user.id, ana);
});

test('celular: aceita código de recuperação na etapa 2 (uma vez)', async () => {
  const { w, ana, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  const { recoveryCodes } = await enableMfa();
  await w.core.auth.verifyMfaLogin({ mfaToken: await phoneChallenge(w, PHONE), code: recoveryCodes[0]! });
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: await phoneChallenge(w, PHONE), code: recoveryCodes[0]! }), 'VALIDATION');
});

test('celular: sem conta ou sem autenticador ligado, a mesma mensagem', async () => {
  const { w, ana } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  const noMfa = await rejectsWith(w.core.auth.startPhoneAuthenticatorLogin(PHONE), 'VALIDATION');
  const noAccount = await rejectsWith(w.core.auth.startPhoneAuthenticatorLogin('+5521999998888'), 'VALIDATION');
  assert.equal(noMfa.message, noAccount.message);
  await rejectsWith(w.core.auth.startPhoneAuthenticatorLogin('abc'), 'VALIDATION');
});

test('celular: conta suspensa não passa da etapa 1', async () => {
  const { w, ana, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  await enableMfa();
  w.users.users.set(ana, { ...w.users.users.get(ana)!, status: 'SUSPENDED' });
  await rejectsWith(w.core.auth.startPhoneAuthenticatorLogin(PHONE), 'FORBIDDEN');
});

test('providers: diz se o SMS está ligado', async () => {
  assert.deepEqual((await setup()).w.core.auth.phoneLoginMethods(), { authenticator: true, sms: true });
  assert.deepEqual((await setup({ noSms: true })).w.core.auth.phoneLoginMethods(), { authenticator: true, sms: false });
});

// ---------- SMS (pronto, desligado por padrão no servidor) ----------

async function verifyPhone(w: Awaited<ReturnType<typeof setup>>['w'], userId: string) {
  await w.core.auth.startPhoneVerification(userId);
  await w.core.auth.confirmPhoneVerification(userId, w.sms.lastCodeFor(PHONE));
}

test('SMS: sem provedor configurado, recusa com mensagem clara', async () => {
  const { w, ana } = await setup({ noSms: true });
  await w.core.profiles.setPhone(ana, PHONE);
  await rejectsWith(w.core.auth.startPhoneVerification(ana), 'VALIDATION');
});

test('SMS: confirmar o celular, entrar com o código e não reaproveitar o código', async () => {
  const { w, ana } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  assert.deepEqual(await w.core.profiles.getPhone(ana), { phone: PHONE, verified: false });
  await rejectsWith(w.core.auth.startPhoneLogin(PHONE), 'VALIDATION');
  await verifyPhone(w, ana);
  assert.deepEqual(await w.core.profiles.getPhone(ana), { phone: PHONE, verified: true });

  await w.core.auth.startPhoneLogin('(11) 98765-4321');
  const code = w.sms.lastCodeFor(PHONE);
  assert.equal(w.sms.sent.at(-1)!.purpose, 'LOGIN');
  const result = await w.core.auth.confirmPhoneLogin({ phone: PHONE, code });
  assert.ok('token' in result && result.user.id === ana);
  await rejectsWith(w.core.auth.confirmPhoneLogin({ phone: PHONE, code }), 'VALIDATION');
});

test('SMS: código de confirmar o celular não serve para entrar', async () => {
  const { w, ana } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  await verifyPhone(w, ana);
  w.clock.tick(PHONE_RESEND_COOLDOWN_SECONDS * 1000);
  await w.core.profiles.setPhone(ana, '+5511900001111');
  await w.core.profiles.setPhone(ana, PHONE);
  assert.equal((await w.core.profiles.getPhone(ana)).verified, false, 'trocar o número apaga a confirmação');
  await w.core.auth.startPhoneVerification(ana);
  await rejectsWith(w.core.auth.confirmPhoneLogin({ phone: PHONE, code: w.sms.lastCodeFor(PHONE) }), 'VALIDATION');
});

test('SMS: espera entre envios e limite de tentativas erradas', async () => {
  const { w, ana } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  await verifyPhone(w, ana);
  await w.core.auth.startPhoneLogin(PHONE);
  await rejectsWith(w.core.auth.startPhoneLogin(PHONE), 'RATE_LIMITED');
  for (let i = 1; i < PHONE_MAX_CODE_ATTEMPTS; i += 1) await rejectsWith(w.core.auth.confirmPhoneLogin({ phone: PHONE, code: '000000' }), 'VALIDATION');
  await rejectsWith(w.core.auth.confirmPhoneLogin({ phone: PHONE, code: '000000' }), 'RATE_LIMITED');
  await rejectsWith(w.core.auth.confirmPhoneLogin({ phone: PHONE, code: w.sms.lastCodeFor(PHONE) }), 'VALIDATION');
});

test('SMS: com autenticador ligado, o código do SMS ainda pede o do app', async () => {
  const { w, ana, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  await verifyPhone(w, ana);
  await enableMfa();
  await w.core.auth.startPhoneLogin(PHONE);
  const result = await w.core.auth.confirmPhoneLogin({ phone: PHONE, code: w.sms.lastCodeFor(PHONE) });
  assert.ok('mfaRequired' in result);
});

test('SMS: falha no provedor descarta o código e deixa pedir de novo', async () => {
  const { w, ana } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  w.sms.failNext = true;
  await rejectsWith(w.core.auth.startPhoneVerification(ana), 'VALIDATION');
  assert.equal(w.phoneCodes.rows.size, 0);
  await w.core.auth.startPhoneVerification(ana);
});
