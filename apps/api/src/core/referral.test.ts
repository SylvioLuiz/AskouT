import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFERRAL_BADGE_THRESHOLD } from './referral-service.ts';
import { asSession, makeWorld } from './testing/world.ts';
import type { UserRole } from './types.ts';

const DAY = 24 * 3_600_000;
const setStatus = (w: ReturnType<typeof makeWorld>, id: string, status: 'ACTIVE' | 'SUSPENDED') => {
  w.users.users.get(id)!.status = status;
};
const actorOf = (s: { user: { id: string; role: UserRole } }) => ({ userId: s.user.id, role: s.user.role });

/** Cadastra `names` pelo convite de `inviter` e devolve as sessões. */
async function inviteAll(w: ReturnType<typeof makeWorld>, inviter: string, names: string[]) {
  const out = [];
  for (const n of names) {
    const s = await w.signUp(n);
    assert.deepEqual(await w.core.referrals.claim(actorOf(s), inviter), { counted: true });
    out.push(s);
  }
  return out;
}

test('convite: registra quem convidou, uma vez só e sem trocar depois', async () => {
  const w = makeWorld();
  await w.signUp('ana');
  await w.signUp('caio');
  const bia = await w.signUp('bia');
  assert.deepEqual(await w.core.referrals.claim(actorOf(bia), '@Ana'), { counted: true });
  assert.deepEqual(await w.core.referrals.claim(actorOf(bia), 'caio'), { counted: false }, 'o primeiro convite vale');
  assert.deepEqual(await w.core.referrals.claim(actorOf(bia), 'ana'), { counted: false });
  const ana = await asSession(w.core.auth.login({ identifier: 'ana', password: 'uma-senha-forte-123' }));
  const overview = await w.core.referrals.overview(actorOf(ana));
  assert.equal(overview.brought, 1);
  assert.deepEqual(overview.people.map((p) => p.profile.username), ['bia']);
  assert.equal((await w.core.referrals.overview(actorOf(await asSession(w.core.auth.login({ identifier: 'caio', password: 'uma-senha-forte-123' }))))).brought, 0);
});

test('convite: ignora o próprio usuário, conta inexistente, texto inválido, suspensa, bloqueada e conta antiga', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const bia = await w.signUp('bia');
  const caio = await w.signUp('caio');
  const dani = await w.signUp('dani');
  assert.equal((await w.core.referrals.claim(actorOf(ana), 'ana')).counted, false, 'o próprio usuário');
  assert.equal((await w.core.referrals.claim(actorOf(bia), 'ninguem')).counted, false, 'conta que não existe');
  assert.equal((await w.core.referrals.claim(actorOf(bia), '!!')).counted, false, 'texto fora do padrão');
  assert.equal((await w.core.referrals.claim(actorOf(bia), undefined)).counted, false);

  setStatus(w, ana.user.id, 'SUSPENDED');
  assert.equal((await w.core.referrals.claim(actorOf(bia), 'ana')).counted, false, 'convidante suspenso');
  setStatus(w, ana.user.id, 'ACTIVE');

  await w.core.blocks.block(caio.user.id, ana.user.id);
  assert.equal((await w.core.referrals.claim(actorOf(caio), 'ana')).counted, false, 'bloqueio em qualquer sentido');
  assert.equal((await w.core.referrals.claim(actorOf(bia), 'ana')).counted, true, 'o convite certo ainda vale');

  w.clock.tick(3 * DAY);
  assert.equal((await w.core.referrals.claim(actorOf(dani), 'ana')).counted, false, 'passada a janela do cadastro');
});

test('lista de quem entrou respeita bloqueios e suspensões', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const [bia, caio, dani] = await inviteAll(w, 'ana', ['bia', 'caio', 'dani']);
  assert.equal((await w.core.referrals.overview(actorOf(ana))).brought, 3);
  await w.core.blocks.block(ana.user.id, bia!.user.id);
  await w.core.blocks.block(caio!.user.id, ana.user.id);
  setStatus(w, dani!.user.id, 'SUSPENDED');
  const view = await w.core.referrals.overview(actorOf(ana));
  assert.equal(view.brought, 0);
  assert.deepEqual(view.people, []);
});

test('selo: só conta quem voltou em outro dia, aparece no perfil e pode ser escondido', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const guests = await inviteAll(w, 'ana', ['bia', 'caio', 'dani']);
  assert.equal(REFERRAL_BADGE_THRESHOLD, 3);

  // No mesmo dia: abrir o app não confirma ninguém (contas em massa não rendem selo).
  for (const g of guests) await w.core.auth.me(actorOf(g));
  let view = await w.core.referrals.overview(actorOf(ana));
  assert.equal(view.brought, 3);
  assert.equal(view.confirmed, 0);
  assert.equal(view.badgeEarned, false);
  assert.equal((await w.core.profiles.getByUsername(ana.user.id, 'ana')).referralBadge, null);

  // Dois voltam no dia seguinte: ainda falta um.
  w.clock.tick(DAY + 1000);
  await w.core.auth.me(actorOf(guests[0]!));
  await w.core.auth.me(actorOf(guests[1]!));
  view = await w.core.referrals.overview(actorOf(ana));
  assert.equal(view.confirmed, 2);
  assert.equal(view.badgeEarned, false);

  await w.core.auth.me(actorOf(guests[2]!));
  view = await w.core.referrals.overview(actorOf(ana));
  assert.equal(view.confirmed, 3);
  assert.equal(view.badgeEarned, true);
  const visitor = guests[0]!;
  assert.equal((await w.core.profiles.getByUsername(visitor.user.id, 'ana')).referralBadge, 3, 'os outros veem o selo');

  assert.deepEqual(await w.core.referrals.setBadgeHidden(actorOf(ana), true), { badgeHidden: true });
  assert.equal((await w.core.profiles.getByUsername(visitor.user.id, 'ana')).referralBadge, null);
  assert.equal((await w.core.referrals.overview(actorOf(ana))).badgeHidden, true);
  await w.core.referrals.setBadgeHidden(actorOf(ana), false);
  assert.equal((await w.core.profiles.getByUsername(visitor.user.id, 'ana')).referralBadge, 3);
});

test('selo: convidado que ficou bloqueado deixa de contar', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const guests = await inviteAll(w, 'ana', ['bia', 'caio', 'dani']);
  w.clock.tick(DAY + 1000);
  for (const g of guests) await w.core.auth.me(actorOf(g));
  assert.equal((await w.core.profiles.getByUsername(ana.user.id, 'ana')).referralBadge, 3);
  await w.core.blocks.block(ana.user.id, guests[2]!.user.id);
  assert.equal((await w.core.profiles.getByUsername(ana.user.id, 'ana')).referralBadge, null);
});

test('gestão: maiores convidantes, só para administradores', async () => {
  const w = makeWorld();
  const ana = await w.signUp('ana');
  const bia = await w.signUp('bia');
  const [, , ...rest] = await inviteAll(w, 'ana', ['caio', 'dani', 'edu']);
  await inviteAll(w, 'bia', ['fabi']);
  w.clock.tick(DAY + 1000);
  await w.core.auth.me(actorOf(rest[0]!));
  const admin = { userId: ana.user.id, role: 'ADMIN' as const };
  const top = await w.core.referrals.adminTop(admin);
  assert.deepEqual(top.map((t) => [t.profile.username, t.brought, t.confirmed]), [['ana', 3, 1], ['bia', 1, 0]]);
  assert.equal((await w.core.referrals.adminTop(admin, 1)).length, 1);
  await assert.rejects(w.core.referrals.adminTop(actorOf(bia)), (e: unknown) => (e as { code?: string }).code === 'FORBIDDEN');
});
