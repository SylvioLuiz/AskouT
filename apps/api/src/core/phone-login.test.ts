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

// ---------- Celular + código do app autenticador ----------

test('celular + autenticador: entra sem senha com o código do app, em qualquer formato de número', async () => {
  const { w, ana, nextCode, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, '(11) 98765-4321');
  const { secret } = await enableMfa();
  const session = await w.core.auth.loginWithPhoneAuthenticator({ phone: '11 98765 4321', code: nextCode(secret) });
  assert.equal(session.user.id, ana);
  assert.ok(session.token);
});

test('celular + autenticador: código errado não entra, e o mesmo código não vale duas vezes', async () => {
  const { w, ana, nextCode, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  const { secret } = await enableMfa();
  await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code: '000000' }), 'VALIDATION');
  const code = nextCode(secret);
  await w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code });
  await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code }), 'VALIDATION');
});

test('celular + autenticador: aceita código de recuperação (uma vez)', async () => {
  const { w, ana, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  const { recoveryCodes } = await enableMfa();
  await w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code: recoveryCodes[0]! });
  await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code: recoveryCodes[0]! }), 'VALIDATION');
});

test('celular + autenticador: sem conta ou sem autenticador ligado, a mesma mensagem', async () => {
  const { w, ana } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  const noMfa = await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code: '123456' }), 'VALIDATION');
  const noAccount = await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: '+5521999998888', code: '123456' }), 'VALIDATION');
  assert.equal(noMfa.message, noAccount.message);
  await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: 'abc', code: '123456' }), 'VALIDATION');
  await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code: '' }), 'VALIDATION');
});

test('celular + autenticador: conta suspensa não entra', async () => {
  const { w, ana, nextCode, enableMfa } = await setup();
  await w.core.profiles.setPhone(ana, PHONE);
  const { secret } = await enableMfa();
  w.users.users.set(ana, { ...w.users.users.get(ana)!, status: 'SUSPENDED' });
  await rejectsWith(w.core.auth.loginWithPhoneAuthenticator({ phone: PHONE, code: nextCode(secret) }), 'FORBIDDEN');
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
