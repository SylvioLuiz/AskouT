import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SENDS,
  RESEND_COOLDOWN_SECONDS,
} from './auth-service.ts';
import { PASSWORD, makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

const MIN = 60_000;
const SEC = 1000;

// ---------- Cadastro, etapa 1: dados e envio do código ----------

test('cadastro: envia o código de 6 dígitos para o e-mail normalizado e não cria conta ainda', async () => {
  const w = makeWorld();
  const started = await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true,
    email: '  Ana@Exemplo.COM ',
    username: '@Ana.Silva',
    password: PASSWORD,
  });

  assert.equal(started.email, 'ana@exemplo.com');
  assert.equal(w.mailer.sent.length, 1);
  assert.equal(w.mailer.sent[0]!.to, 'ana@exemplo.com');
  assert.match(w.mailer.sent[0]!.code, /^\d{6}$/);
  assert.equal(w.mailer.sent[0]!.expiresInMinutes, CODE_TTL_MINUTES);
  assert.equal(started.expiresAt.getTime(), w.clock.now().getTime() + CODE_TTL_MINUTES * MIN);
  assert.equal(started.resendAvailableAt.getTime(), w.clock.now().getTime() + RESEND_COOLDOWN_SECONDS * SEC);

  assert.equal(await w.users.findByEmail('ana@exemplo.com'), undefined, 'ainda não existe conta');
  assert.ok(!JSON.stringify(started).includes(w.mailer.sent[0]!.code), 'o código não volta na resposta');
});

test('cadastro: o pendente guarda só hashes, nunca a senha nem o código', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const code = w.mailer.lastCodeFor('ana@exemplo.com');
  const row = (await w.pending.find('ana@exemplo.com'))!;

  const stored = JSON.stringify(row);
  assert.ok(!stored.includes(PASSWORD));
  assert.ok(!stored.includes(code));
  assert.equal(await w.hasher.verify(PASSWORD, row.passwordHash), true);
  assert.equal(row.attempts, 0);
  assert.equal(row.sendCount, 1);
  assert.equal(row.displayName, 'ana', 'nome padrão = username');
});

test('cadastro: reúne todos os campos inválidos em um único erro e não envia e-mail', async () => {
  const w = makeWorld();
  const err = await rejectsWith(
    w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'nao-e-email', username: 'a', password: '123' }),
    'VALIDATION',
  );
  assert.deepEqual(Object.keys(err.details ?? {}).sort(), ['email', 'password', 'username']);
  assert.equal(w.mailer.sent.length, 0);
});

test('cadastro: valores que não são texto e username reservado viram erro de validação', async () => {
  const w = makeWorld();
  await rejectsWith(w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 123, username: {}, password: null }), 'VALIDATION');
  await rejectsWith(w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: ['a@b.com'], username: 'ana', password: PASSWORD }), 'VALIDATION');
  await rejectsWith(w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'a@b.com', username: 'admin', password: PASSWORD }), 'VALIDATION');
  assert.equal(w.mailer.sent.length, 0);
});

test('cadastro: e-mail ou username já em uso são avisados logo na primeira etapa (como o Instagram)', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  const sentBefore = w.mailer.sent.length;

  const email = await rejectsWith(
    w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ANA@exemplo.com', username: 'outra', password: PASSWORD }),
    'CONFLICT',
  );
  assert.ok(email.details?.email);

  const username = await rejectsWith(
    w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'outra@exemplo.com', username: '@ANA', password: PASSWORD }),
    'CONFLICT',
  );
  assert.ok(username.details?.username);
  assert.equal(w.mailer.sent.length, sentBefore, 'nenhum e-mail enviado');
});

// ---------- Cadastro, etapa 2: confirmação ----------

test('confirmar: cria a conta com os dados do cadastro, devolve a sessão e limpa o pendente', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true,
    email: 'ana@exemplo.com',
    username: 'ana.silva',
    displayName: ' Ana   Silva ',
    password: PASSWORD,
  });
  const result = await w.core.auth.confirmSignup({
    email: 'ANA@exemplo.com',
    code: ` ${w.mailer.lastCodeFor('ana@exemplo.com')} `,
  });

  assert.equal(result.user.email, 'ana@exemplo.com');
  assert.equal(result.user.role, 'USER');
  assert.equal(result.user.profile.username, 'ana.silva');
  assert.equal(result.user.profile.displayName, 'Ana Silva');
  assert.equal(result.user.profile.isPrivate, false, 'perfil começa público');
  assert.equal(await w.pending.find('ana@exemplo.com'), undefined);

  const json = JSON.stringify(result);
  assert.ok(!json.includes('passwordHash') && !json.includes('scrypt$') && !json.includes(PASSWORD));

  const actor = await w.core.auth.authenticate(result.token);
  assert.equal(actor.userId, result.user.id);

  const stored = (await w.users.findById(result.user.id))!;
  assert.equal(stored.status, 'ACTIVE');
  assert.equal(await w.hasher.verify(PASSWORD, stored.passwordHash), true);
});

test('confirmar: o e-mail não aparece no perfil público', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const bia = await w.signUp('bia');
  const view = await w.core.profiles.getByUsername(bia.user.id, 'ana');
  assert.ok(!JSON.stringify(view).includes('ana@exemplo.com'));
  assert.ok(!JSON.stringify(await w.core.profiles.search(bia.user.id, 'an')).includes('@exemplo.com'));
  assert.equal(ana.user.email, 'ana@exemplo.com', 'o próprio dono recebe o e-mail na sessão');
});

test('confirmar: código errado dá erro e conta a tentativa; o certo ainda vale dentro do limite', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const right = w.mailer.lastCodeFor('ana@exemplo.com');
  const wrong = right === '000000' ? '000001' : '000000';

  for (let i = 1; i < MAX_CODE_ATTEMPTS; i += 1) {
    await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: wrong }), 'VALIDATION');
    assert.equal((await w.pending.find('ana@exemplo.com'))!.attempts, i);
  }
  const ok = await w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: right });
  assert.equal(ok.user.profile.username, 'ana');
});

test('confirmar: atingir o limite de tentativas erradas descarta o cadastro, mesmo para o código certo', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const right = w.mailer.lastCodeFor('ana@exemplo.com');
  const wrong = right === '000000' ? '000001' : '000000';

  for (let i = 1; i < MAX_CODE_ATTEMPTS; i += 1) {
    await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: wrong }), 'VALIDATION');
  }
  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: wrong }), 'RATE_LIMITED');
  assert.equal(await w.pending.find('ana@exemplo.com'), undefined);
  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: right }), 'VALIDATION');
  assert.equal(await w.users.findByEmail('ana@exemplo.com'), undefined, 'nenhuma conta criada');
});

test('confirmar: um contador já no limite também bloqueia o código certo', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const right = w.mailer.lastCodeFor('ana@exemplo.com');
  w.pending.rows.get('ana@exemplo.com')!.attempts = MAX_CODE_ATTEMPTS;
  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: right }), 'RATE_LIMITED');
  assert.equal(await w.users.findByEmail('ana@exemplo.com'), undefined);
});

test('confirmar: formato inválido não gasta tentativa', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  for (const bad of ['abc123', '12345', '1234567', '', undefined, 123456, '12 456']) {
    await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: bad }), 'VALIDATION');
  }
  assert.equal((await w.pending.find('ana@exemplo.com'))!.attempts, 0);
});

test('confirmar: sem cadastro pendente dá a mesma resposta de código expirado', async () => {
  const w = makeWorld();
  const err = await rejectsWith(w.core.auth.confirmSignup({ email: 'ninguem@exemplo.com', code: '123456' }), 'VALIDATION');
  assert.match(err.message, /inválido ou expirado/);
});

test('confirmar: o código vale por 10 minutos, nem um instante a mais', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const code = w.mailer.lastCodeFor('ana@exemplo.com');

  w.clock.tick(CODE_TTL_MINUTES * MIN - SEC);
  await w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code }); // 9min59s: vale

  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'bia@exemplo.com', username: 'bia', password: PASSWORD });
  const codeBia = w.mailer.lastCodeFor('bia@exemplo.com');
  w.clock.tick(CODE_TTL_MINUTES * MIN);
  await rejectsWith(w.core.auth.confirmSignup({ email: 'bia@exemplo.com', code: codeBia }), 'VALIDATION');
  assert.equal(await w.pending.find('bia@exemplo.com'), undefined, 'expirado é descartado');
});

test('confirmar: o código está amarrado ao e-mail (o de outra pessoa não serve)', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'bia@exemplo.com', username: 'bia', password: PASSWORD });
  const codeBia = w.mailer.lastCodeFor('bia@exemplo.com');
  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: codeBia }), 'VALIDATION');
  assert.equal(await w.users.findByEmail('ana@exemplo.com'), undefined);
});

test('confirmar: se tomarem o username no meio do caminho, dá CONFLICT e descarta o pendente', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const code = w.mailer.lastCodeFor('ana@exemplo.com');

  // outra pessoa conclui o cadastro com o mesmo username antes
  await w.signUp('ana', { email: 'outra@exemplo.com' });

  const err = await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code }), 'CONFLICT');
  assert.ok(err.details?.username);
  assert.equal(await w.pending.find('ana@exemplo.com'), undefined);
  assert.equal(await w.users.findByEmail('ana@exemplo.com'), undefined);
});

test('confirmar: não dá para confirmar duas vezes (o pendente some)', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const code = w.mailer.lastCodeFor('ana@exemplo.com');
  await w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code });
  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code }), 'VALIDATION');
});

// ---------- Reenvio e limites de envio ----------

test('reenvio: pedir de novo antes de 60 segundos dá RATE_LIMITED com o tempo de espera', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });

  w.clock.tick(20 * SEC);
  const byStart = await rejectsWith(
    w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD }),
    'RATE_LIMITED',
  );
  assert.equal(byStart.details?.retryAfterSeconds, '40');
  const byResend = await rejectsWith(w.core.auth.resendSignupCode('ana@exemplo.com'), 'RATE_LIMITED');
  assert.equal(byResend.details?.retryAfterSeconds, '40');
  assert.equal(w.mailer.sent.length, 1, 'nenhum e-mail extra');
});

test('reenvio: depois do intervalo, o novo código vale e o antigo deixa de valer', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const first = w.mailer.lastCodeFor('ana@exemplo.com');

  w.clock.tick(RESEND_COOLDOWN_SECONDS * SEC);
  const again = await w.core.auth.resendSignupCode('ana@exemplo.com');
  const second = w.mailer.lastCodeFor('ana@exemplo.com');
  assert.notEqual(first, second);
  assert.equal(again.expiresAt.getTime(), w.clock.now().getTime() + CODE_TTL_MINUTES * MIN);
  assert.equal((await w.pending.find('ana@exemplo.com'))!.sendCount, 2);

  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: first }), 'VALIDATION');
  const ok = await w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: second });
  assert.equal(ok.user.profile.username, 'ana');
});

test('reenvio: zera as tentativas erradas e mantém os dados do cadastro', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', displayName: 'Ana', password: PASSWORD });
  const before = (await w.pending.find('ana@exemplo.com'))!;
  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: '000000' }), 'VALIDATION');

  w.clock.tick(RESEND_COOLDOWN_SECONDS * SEC);
  await w.core.auth.resendSignupCode('ana@exemplo.com');
  const after = (await w.pending.find('ana@exemplo.com'))!;
  assert.equal(after.attempts, 0);
  assert.equal(after.passwordHash, before.passwordHash);
  assert.equal(after.username, 'ana');
  assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
});

test('reenvio: sem cadastro pendente ou depois de expirar dá NOT_FOUND', async () => {
  const w = makeWorld();
  await rejectsWith(w.core.auth.resendSignupCode('ninguem@exemplo.com'), 'NOT_FOUND');
  await rejectsWith(w.core.auth.resendSignupCode(undefined), 'NOT_FOUND');

  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  w.clock.tick(CODE_TTL_MINUTES * MIN);
  await rejectsWith(w.core.auth.resendSignupCode('ana@exemplo.com'), 'NOT_FOUND');
  assert.equal(await w.pending.find('ana@exemplo.com'), undefined);
});

test('envios: no máximo 5 códigos por janela de cadastro; o limite vale também para começar de novo', async () => {
  const w = makeWorld();
  const input = { email: 'ana@exemplo.com', username: 'ana', password: PASSWORD, birthDate: '1990-01-01', acceptTerms: true };
  await w.core.auth.startSignup(input);
  for (let i = 1; i < MAX_CODE_SENDS; i += 1) {
    w.clock.tick((RESEND_COOLDOWN_SECONDS + 1) * SEC);
    await w.core.auth.resendSignupCode('ana@exemplo.com');
  }
  assert.equal(w.mailer.sent.length, MAX_CODE_SENDS);

  w.clock.tick((RESEND_COOLDOWN_SECONDS + 1) * SEC);
  await rejectsWith(w.core.auth.resendSignupCode('ana@exemplo.com'), 'RATE_LIMITED');
  await rejectsWith(w.core.auth.startSignup(input), 'RATE_LIMITED');
  assert.equal(w.mailer.sent.length, MAX_CODE_SENDS, 'nenhum envio além do limite');
});

test('envios: depois que a janela expira, dá para recomeçar do zero', async () => {
  const w = makeWorld();
  const input = { email: 'ana@exemplo.com', username: 'ana', password: PASSWORD, birthDate: '1990-01-01', acceptTerms: true };
  await w.core.auth.startSignup(input);
  for (let i = 1; i < MAX_CODE_SENDS; i += 1) {
    w.clock.tick((RESEND_COOLDOWN_SECONDS + 1) * SEC);
    await w.core.auth.resendSignupCode('ana@exemplo.com');
  }
  w.clock.tick(CODE_TTL_MINUTES * MIN);
  await w.core.auth.startSignup(input);
  assert.equal((await w.pending.find('ana@exemplo.com'))!.sendCount, 1);
});

test('recomeçar o cadastro depois do intervalo substitui os dados e invalida o código anterior', async () => {
  const w = makeWorld();
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  const first = w.mailer.lastCodeFor('ana@exemplo.com');

  w.clock.tick((RESEND_COOLDOWN_SECONDS + 1) * SEC);
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana.nova', password: PASSWORD });
  const second = w.mailer.lastCodeFor('ana@exemplo.com');

  await rejectsWith(w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: first }), 'VALIDATION');
  const ok = await w.core.auth.confirmSignup({ email: 'ana@exemplo.com', code: second });
  assert.equal(ok.user.profile.username, 'ana.nova');
});

test('falha no envio do e-mail: o erro chega a quem chamou e o pendente é descartado', async () => {
  const w = makeWorld();
  w.mailer.failNext = true;
  await assert.rejects(
    w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD }),
    /falha simulada/,
  );
  assert.equal(await w.pending.find('ana@exemplo.com'), undefined);

  // sem espera: não ficou intervalo preso por um envio que não aconteceu
  await w.core.auth.startSignup({ birthDate: "1990-01-01", acceptTerms: true, email: 'ana@exemplo.com', username: 'ana', password: PASSWORD });
  assert.equal(w.mailer.sent.length, 1);
});

// ---------- Login por e-mail ou @usuario ----------

test('login: por e-mail, por usuario e por @usuario, sem diferenciar maiúsculas', async () => {
  const w = makeWorld();
  const reg = await w.signUp('ana.silva', { email: 'ana@exemplo.com' });
  for (const identifier of ['ana@exemplo.com', '  ANA@Exemplo.com ', 'ana.silva', '@ana.silva', '@ANA.Silva']) {
    const login = await w.core.auth.login({ identifier, password: PASSWORD });
    assert.equal(login.user.id, reg.user.id, identifier);
  }
});

test('login: o token devolvido autentica o usuário', async () => {
  const w = makeWorld();
  const reg = await w.signUp('ana');
  const login = await w.core.auth.login({ identifier: 'ana@exemplo.com', password: PASSWORD });
  assert.deepEqual(await w.core.auth.authenticate(login.token), { userId: reg.user.id, role: 'USER' });
});

test('login: senha errada e conta inexistente dão a mesma resposta, por e-mail ou por usuario', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  const messages = new Set<string>();
  for (const [identifier, password] of [
    ['ana@exemplo.com', 'errada-123'],
    ['ana', 'errada-123'],
    ['ninguem@exemplo.com', PASSWORD],
    ['@ninguem', PASSWORD],
  ] as const) {
    const err = await rejectsWith(w.core.auth.login({ identifier, password }), 'UNAUTHORIZED');
    messages.add(err.message);
  }
  assert.equal(messages.size, 1);
});

test('login: o e-mail de outra pessoa não vale como usuario e vice-versa', async () => {
  const w = makeWorld();
  await w.signUp('ana', { email: 'ana@exemplo.com' });
  await w.signUp('bia', { email: 'bia@exemplo.com' });
  await rejectsWith(w.core.auth.login({ identifier: 'ana@exemplo.com', password: 'senha-da-bia-123' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: '@ana@exemplo.com', password: PASSWORD }), 'UNAUTHORIZED');
});

test('login: entradas absurdas são recusadas', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  await rejectsWith(w.core.auth.login({ identifier: 'ana', password: '' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: 'ana', password: 'x'.repeat(5000) }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: '', password: PASSWORD }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: '@', password: PASSWORD }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: 'a'.repeat(300), password: PASSWORD }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: undefined, password: undefined }), 'UNAUTHORIZED');
});

test('login: calcula o hash mesmo quando a conta não existe (sem vazar pelo tempo)', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  const seen: string[] = [];
  const original = w.hasher.verify.bind(w.hasher);
  w.hasher.verify = async (password, stored) => {
    seen.push(stored);
    return original(password, stored);
  };
  await rejectsWith(w.core.auth.login({ identifier: 'ninguem@exemplo.com', password: PASSWORD }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.login({ identifier: '@ninguem', password: PASSWORD }), 'UNAUTHORIZED');
  assert.equal(seen.length, 2);
  for (const stored of seen) assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$/, 'verifica contra um hash real');
});

test('login: conta suspensa só é revelada a quem sabe a senha', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';

  await rejectsWith(w.core.auth.login({ identifier: 'ana@exemplo.com', password: PASSWORD }), 'FORBIDDEN');
  await rejectsWith(w.core.auth.login({ identifier: '@ana', password: PASSWORD }), 'FORBIDDEN');
  await rejectsWith(w.core.auth.login({ identifier: 'ana@exemplo.com', password: 'errada-123' }), 'UNAUTHORIZED');
});

test('login: conta com exclusão solicitada ainda pode entrar', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.get(ana.user.id)!.status = 'DELETION_REQUESTED';
  const login = await w.core.auth.login({ identifier: 'ana', password: PASSWORD });
  assert.equal(login.user.id, ana.user.id);
});

// ---------- Sessão ----------

test('autenticação: token adulterado, vazio ou de outro tipo é recusado', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  await rejectsWith(w.core.auth.authenticate(ana.token + 'x'), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.authenticate(''), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.authenticate(undefined), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.authenticate(42), 'UNAUTHORIZED');
});

test('autenticação: token expirado é recusado', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.clock.tick(2 * 60 * 60 * 1000); // TTL padrão é 1 hora
  await rejectsWith(w.core.auth.authenticate(ana.token), 'UNAUTHORIZED');
});

test('autenticação: suspensão vale na hora, mesmo com token ainda válido', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  assert.ok(await w.core.auth.authenticate(ana.token));
  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';
  await rejectsWith(w.core.auth.authenticate(ana.token), 'UNAUTHORIZED');
});

test('autenticação: o papel vem do banco, não do token', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.get(ana.user.id)!.role = 'ADMIN';
  const actor = await w.core.auth.authenticate(ana.token);
  assert.equal(actor.role, 'ADMIN');
});

test('autenticação: usuário removido deixa o token inválido', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  w.users.users.delete(ana.user.id);
  await rejectsWith(w.core.auth.authenticate(ana.token), 'UNAUTHORIZED');
});

test('sessão (me): devolve os dados do próprio usuário e recusa conta removida ou suspensa', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana', { displayName: 'Ana' });
  const me = await w.core.auth.me({ userId: ana.user.id, role: 'USER' });
  assert.equal(me.email, 'ana@exemplo.com');
  assert.equal(me.profile.displayName, 'Ana');
  assert.ok(!JSON.stringify(me).includes('passwordHash'));

  w.users.users.get(ana.user.id)!.status = 'SUSPENDED';
  await rejectsWith(w.core.auth.me({ userId: ana.user.id, role: 'USER' }), 'UNAUTHORIZED');
  await rejectsWith(w.core.auth.me({ userId: 'nao-existe', role: 'USER' }), 'UNAUTHORIZED');
});

test('repositório: barra e-mail e username duplicados mesmo sem passar pelo serviço (corrida)', async () => {
  const w = makeWorld();
  const a = await w.signUp('ana');
  const user = (await w.users.findById(a.user.id))!;
  const profile = (await w.users.findProfileById(a.user.id))!;
  await rejectsWith(w.users.create({ ...user, id: 'x' }, { ...profile, userId: 'x', username: 'novo' }), 'CONFLICT');
  await rejectsWith(
    w.users.create({ ...user, id: 'y', email: 'novo@exemplo.com' }, { ...profile, userId: 'y' }),
    'CONFLICT',
  );
});

test('boas-vindas: enviadas ao criar a conta; se o envio falhar, o cadastro conclui igual', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  assert.deepEqual(w.mailer.welcomes, [{ to: 'ana@exemplo.com', username: 'ana' }]);
  w.mailer.failNotices = true;
  const bia = await w.signUp('bia');
  assert.ok(bia.token);
  assert.equal(w.mailer.welcomes.length, 1);
});
