import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MFA_MAX_FAILURES } from './mfa-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { PASSWORD, makeWorld } from './testing/world.ts';
import { totpCode, totpStep } from './totp.ts';

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('ana');
  const ana = u['ana']!;
  const username = 'ana';
  const nextCode = (secret: string) => {
    // cada código do app só vale uma vez: avança um passo de 30s a cada uso
    w.clock.tick(30_000);
    return totpCode(secret, totpStep(w.clock.now()));
  };
  async function enable() {
    const setupInfo = await w.core.auth.mfa.setup(ana);
    const { recoveryCodes } = await w.core.auth.mfa.enable(ana, nextCode(setupInfo.secret));
    return { secret: setupInfo.secret, recoveryCodes };
  }
  return { w, ana, username, nextCode, enable };
}

test('MFA: configurar só liga depois de confirmar com um código; segredo fica cifrado no banco', async () => {
  const { w, ana, nextCode } = await setup();
  const info = await w.core.auth.mfa.setup(ana);
  assert.match(info.otpauthUrl, /^otpauth:\/\/totp\//);
  assert.deepEqual(await w.core.auth.mfa.status(ana), { enabled: false, pendingSetup: true, recoveryCodesLeft: 0 });
  assert.ok(!w.mfa.rows.get(ana)!.secretSealed.includes(info.secret), 'segredo não fica em texto puro');
  await rejectsWith(w.core.auth.mfa.enable(ana, '000000'), 'VALIDATION');
  const { recoveryCodes } = await w.core.auth.mfa.enable(ana, nextCode(info.secret));
  assert.equal(recoveryCodes.length, 10);
  assert.equal((await w.core.auth.mfa.status(ana)).enabled, true);
});

test('MFA: login pede o código; senha sozinha não dá sessão e o código não vale duas vezes', async () => {
  const { w, username, enable, nextCode } = await setup();
  const { secret } = await enable();
  const challenge = await w.core.auth.login({ identifier: username, password: PASSWORD });
  assert.ok('mfaRequired' in challenge);
  if (!('mfaRequired' in challenge)) return;
  await rejectsWith(w.core.auth.authenticate(challenge.mfaToken), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: challenge.mfaToken, code: '123456' }), 'VALIDATION');
  const code = nextCode(secret);
  const session = await w.core.auth.verifyMfaLogin({ mfaToken: challenge.mfaToken, code });
  assert.ok(session.token);
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: challenge.mfaToken, code }), 'VALIDATION');
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: 'mfa.x.y', code }), 'UNAUTHORIZED');
});

test('MFA: código de recuperação vale uma vez', async () => {
  const { w, username, enable } = await setup();
  const { recoveryCodes } = await enable();
  const login = async () => {
    const c = await w.core.auth.login({ identifier: username, password: PASSWORD });
    if (!('mfaRequired' in c)) throw new Error('esperava desafio');
    return c.mfaToken;
  };
  const ok = await w.core.auth.verifyMfaLogin({ mfaToken: await login(), code: recoveryCodes[0]!.toLowerCase() });
  assert.ok(ok.token);
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: await login(), code: recoveryCodes[0]! }), 'VALIDATION');
});

test('MFA: erros seguidos bloqueiam a conta por um tempo', async () => {
  const { w, username, enable } = await setup();
  await enable();
  const c = await w.core.auth.login({ identifier: username, password: PASSWORD });
  if (!('mfaRequired' in c)) throw new Error('esperava desafio');
  for (let i = 0; i < MFA_MAX_FAILURES - 1; i += 1) await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: c.mfaToken, code: '000000' }), 'VALIDATION');
  await rejectsWith(w.core.auth.verifyMfaLogin({ mfaToken: c.mfaToken, code: '000000' }), 'RATE_LIMITED');
});

test('MFA: desligar exige código; depois o login volta a ser só senha', async () => {
  const { w, ana, username, enable, nextCode } = await setup();
  const { secret } = await enable();
  await rejectsWith(w.core.auth.mfa.disable(ana, '000000'), 'VALIDATION');
  await w.core.auth.mfa.disable(ana, nextCode(secret));
  const s = await w.core.auth.login({ identifier: username, password: PASSWORD });
  assert.ok(!('mfaRequired' in s));
});

test('MFA: painel de gestão também pede o código', async () => {
  const { w, ana, username, enable, nextCode } = await setup();
  const { secret } = await enable();
  w.users.users.set(ana, { ...w.users.users.get(ana)!, role: 'ADMIN' });
  const c = await w.core.admin.login({ identifier: username, password: PASSWORD });
  assert.ok('mfaRequired' in c);
  if (!('mfaRequired' in c)) return;
  const s = await w.core.admin.verifyMfaLogin({ mfaToken: c.mfaToken, code: nextCode(secret) });
  assert.equal(s.user.role, 'ADMIN');
});
