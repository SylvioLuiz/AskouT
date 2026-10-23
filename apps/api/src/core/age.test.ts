import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn } from './age-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

test('ageOn: o aniversário conta no próprio dia', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(ageOn('2008-10-22', now), 18);
  assert.equal(ageOn('2008-10-23', now), 17);
  assert.equal(ageOn('2000-02-29', now), 26);
  assert.equal(ageOn('lixo', now), -1);
});

test('Flash: conta antiga, sem data de nascimento, não liga nem vê ninguém', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  w.users.users.set(ana, { ...w.users.users.get(ana)!, birthDate: null });
  assert.deepEqual(await w.core.age.status(ana), { declared: false, adult: false, birthDate: null, locked: false });
  await rejectsWith(w.core.flash.turnOn(ana, { hours: 1 }), 'FORBIDDEN');
  await rejectsWith(w.core.flash.listAvailable(ana), 'FORBIDDEN');
  // Informa a data uma vez; depois disso é maior de idade e liga.
  assert.deepEqual(await w.core.age.declare(ana, { birthDate: '1990-05-10' }), { declared: true, adult: true, birthDate: '1990-05-10', locked: false });
  assert.equal((await w.core.flash.turnOn(ana, { hours: 1 })).active, true);
  await rejectsWith(w.core.age.declare(ana, { birthDate: '1991-05-10' }), 'CONFLICT');
});

test('Flash: quem se cadastrou com 17 anos é recusado e a data não muda', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana', { minor: true })).user.id;
  assert.deepEqual(await w.core.age.status(ana), { declared: true, adult: false, birthDate: `${w.clock.now().getUTCFullYear() - 17}-01-01`, locked: true });
  await rejectsWith(w.core.flash.turnOn(ana, { hours: 1 }), 'FORBIDDEN');
  await rejectsWith(w.core.age.declare(ana, { birthDate: '1990-01-01' }), 'CONFLICT');
  assert.equal((await w.core.age.status(ana)).adult, false);
});

test('Cadastro: exige data válida, 13 anos ou mais e o aceite dos Termos; guarda os dois', async () => {
  const w = makeWorld();
  const base = { email: 'ana@exemplo.com', username: 'ana', password: 'uma-senha-forte-123' };
  const y = w.clock.now().getUTCFullYear();
  await rejectsWith(w.core.auth.startSignup({ ...base, acceptTerms: true }), 'VALIDATION');
  await rejectsWith(w.core.auth.startSignup({ ...base, birthDate: '1990-01-01' }), 'VALIDATION');
  await rejectsWith(w.core.auth.startSignup({ ...base, birthDate: '1990-01-01', acceptTerms: 'sim' }), 'VALIDATION');
  await rejectsWith(w.core.auth.startSignup({ ...base, birthDate: '2001-02-30', acceptTerms: true }), 'VALIDATION');
  const small = await rejectsWith(w.core.auth.startSignup({ ...base, birthDate: `${y - 12}-01-01`, acceptTerms: true }), 'VALIDATION');
  assert.ok(small.details && 'birthDate' in small.details);
  assert.equal(w.mailer.sent.length, 0, 'nada é enviado se o cadastro foi recusado');

  await w.core.auth.startSignup({ ...base, birthDate: `${y - 15}-01-01`, acceptTerms: true });
  const session = await w.core.auth.confirmSignup({ email: base.email, code: w.mailer.lastCodeFor(base.email) });
  const user = w.users.users.get(session.user.id)!;
  assert.equal(user.birthDate, `${y - 15}-01-01`);
  assert.equal(user.termsVersion, '2026-10-22');
  assert.ok(user.termsAcceptedAt instanceof Date);
  assert.equal((await w.core.age.status(user.id)).adult, false, '15 anos: tem conta, mas sem Flash');
});

test('Corrigir a data: adulto pode; quem consta como menor não; nunca abaixo de 13', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  const y = w.clock.now().getUTCFullYear();
  assert.equal((await w.core.age.correct(ana, { birthDate: '1985-03-02' })).birthDate, '1985-03-02');
  assert.equal((await w.users.findById(ana))?.birthDate, '1985-03-02');
  await rejectsWith(w.core.age.correct(ana, { birthDate: `${y - 10}-01-01` }), 'VALIDATION');
  await rejectsWith(w.core.age.correct(ana, { birthDate: 'lixo' }), 'VALIDATION');
  // Menor: bloqueado, não consegue "virar adulto" corrigindo.
  const bia = (await w.signUp('bia', { minor: true })).user.id;
  await rejectsWith(w.core.age.correct(bia, { birthDate: '1990-01-01' }), 'FORBIDDEN');
  assert.equal((await w.core.age.status(bia)).adult, false);
  // Adulto que corrige para menor perde o Flash e não volta sozinho.
  const caio = (await w.signUp('caio')).user.id;
  assert.equal((await w.core.age.correct(caio, { birthDate: `${y - 16}-01-01` })).adult, false);
  await rejectsWith(w.core.age.correct(caio, { birthDate: '1990-01-01' }), 'FORBIDDEN');
});

test('Termos: conta sem aceite ou com versão antiga precisa aceitar a atual; versão errada é recusada', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  const atual = await w.core.age.termsStatus(ana);
  assert.equal(atual.upToDate, true, 'quem acabou de se cadastrar já aceitou a versão atual');
  // Conta antiga: sem registro de aceite.
  w.users.users.set(ana, { ...w.users.users.get(ana)!, termsVersion: null, termsAcceptedAt: null });
  const antiga = await w.core.age.termsStatus(ana);
  assert.deepEqual({ ...antiga, currentVersion: undefined }, { currentVersion: undefined, acceptedVersion: null, acceptedAt: null, upToDate: false });
  await rejectsWith(w.core.age.acceptTerms(ana, { version: '1999-01-01' }), 'VALIDATION');
  await rejectsWith(w.core.age.acceptTerms(ana, {}), 'VALIDATION');
  assert.equal((await w.core.age.termsStatus(ana)).upToDate, false);
  const depois = await w.core.age.acceptTerms(ana, { version: atual.currentVersion });
  assert.equal(depois.upToDate, true);
  assert.ok(depois.acceptedAt);
});
