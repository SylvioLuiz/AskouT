import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_CACHE_MS, GUEST_ACCOUNT_MIN_DAYS, NOW_MIN_PEOPLE, ORGANIZER_MIN_GUESTS, REGULAR_MIN_CROWD, REGULAR_MIN_EVENTS, REGULAR_PER_ORGANIZER } from './badge-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const DAY = 24 * H;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;
type World = ReturnType<typeof makeWorld>;

const badgesOf = async (w: World, viewer: string, username: string) => (await w.core.profiles.getByUsername(viewer, username)).badges.map((b) => `${b.id}:${b.count}${b.hidden ? ':hidden' : ''}`);
const at = (w: World, hours: number) => new Date(w.clock.now().getTime() + hours * H);
const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Evento criado por `owner` daqui a `inHours`, com 2 h de duração. */
async function userEvent(w: World, owner: string, title: string, inHours = 2) {
  return w.core.posts.create(owner, { images: [JPEG], placeName: 'Praça', event: { title, startsAt: at(w, inHours).toISOString(), endsAt: at(w, inHours + 2).toISOString() } });
}

test('Organizador: evento que já começou com 10 convidados que valem', async () => {
  assert.equal(ORGANIZER_MIN_GUESTS, 10);
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  const guests = Object.values(await w.signUpMany(...names('guest', ORGANIZER_MIN_GUESTS))) as string[];
  w.clock.tick((GUEST_ACCOUNT_MIN_DAYS + 1) * DAY);
  const visitor = (await w.signUp('visita')).user.id;
  const festa = await userEvent(w, ana, 'Festa');
  for (const g of guests.slice(0, -1)) await w.core.eventPages.go(g, festa.id);
  w.clock.tick(3 * H);
  assert.deepEqual(await badgesOf(w, ana, 'ana'), [], 'com 9 ainda não');

  // Quem confirma depois do fim não conta (o app nem deixa, então gravamos direto).
  await w.eventRoom.addGoing({ source: 'USER', id: festa.id }, guests.at(-1)!, at(w, 2));
  assert.deepEqual(await badgesOf(w, ana, 'ana'), [], 'confirmou depois do fim');
  await w.eventRoom.removeGoing({ source: 'USER', id: festa.id }, guests.at(-1)!);
  await w.eventRoom.addGoing({ source: 'USER', id: festa.id }, guests.at(-1)!, at(w, -2));
  assert.deepEqual(await badgesOf(w, ana, 'ana'), ['ORGANIZER:1']);
  assert.deepEqual(await badgesOf(w, visitor, 'ana'), ['ORGANIZER:1'], 'os outros veem o selo');

  // Convidado suspenso ou bloqueado deixa de contar (no próprio perfil recalcula na hora).
  await w.core.blocks.block(ana, guests[0]!);
  assert.deepEqual(await badgesOf(w, ana, 'ana'), []);
});

test('Organizador: contas novas demais e eventos que ainda não começaram não contam', async () => {
  const w = makeWorld();
  const ana = (await w.signUp('ana')).user.id;
  const old = Object.values(await w.signUpMany(...names('velha', ORGANIZER_MIN_GUESTS - 1))) as string[];
  w.clock.tick((GUEST_ACCOUNT_MIN_DAYS + 1) * DAY);
  const fresh = (await w.signUp('nova')).user.id;
  const festa = await userEvent(w, ana, 'Festa', 48);
  for (const g of [...old, fresh]) await w.core.eventPages.go(g, festa.id);
  assert.deepEqual(await badgesOf(w, ana, 'ana'), [], 'ainda não começou');
  w.clock.tick(49 * H);
  assert.deepEqual(await badgesOf(w, ana, 'ana'), [], 'a conta nova (criada 1 semana antes) não vale');
});

test('Figurinha carimbada: 10 eventos que já acabaram, com gente, de organizadores diferentes', async () => {
  assert.ok(REGULAR_MIN_CROWD >= 3 && REGULAR_PER_ORGANIZER === 2 && REGULAR_MIN_EVENTS === 10);
  const w = makeWorld();
  const bia = (await w.signUp('bia')).user.id;
  const crowd = Object.values(await w.signUpMany('turma1', 'turma2')) as string[];
  const organizers = Object.values(await w.signUpMany(...names('org', 6))) as string[];
  // 6 organizadores com 2 eventos cada = 12 eventos, mas um deles cria 3: o terceiro não conta.
  const events: string[] = [];
  for (const o of organizers) for (const n of [1, 2]) events.push((await userEvent(w, o, `${o}-${n}`)).id);
  const extra = (await userEvent(w, organizers[0]!, 'terceiro')).id;
  const empty = (await userEvent(w, organizers[1]!, 'vazio')).id;
  for (const id of [...events, extra]) for (const p of [bia, ...crowd]) await w.core.eventPages.go(p, id);
  await w.core.eventPages.go(bia, empty);
  assert.deepEqual(await badgesOf(w, bia, 'bia'), [], 'antes de acabar não conta');
  w.clock.tick(5 * H);
  assert.deepEqual(await badgesOf(w, bia, 'bia'), ['REGULAR:12']);

  // Bloquear um organizador tira os eventos dele; 10 ainda bastam, 8 não.
  await w.core.blocks.block(bia, organizers[2]!);
  assert.deepEqual(await badgesOf(w, bia, 'bia'), ['REGULAR:10']);
  await w.core.blocks.block(organizers[3]!, bia);
  assert.deepEqual(await badgesOf(w, bia, 'bia'), []);
});

test('Topa tudo: 5 pessoas diferentes encontradas pelo NOW', async () => {
  assert.equal(NOW_MIN_PEOPLE, 5);
  const w = makeWorld();
  const caio = (await w.signUp('caio')).user.id;
  const friends = Object.values(await w.signUpMany(...names('amigo', NOW_MIN_PEOPLE))) as string[];
  const meet = async (other: string, n: number) => {
    const album = await w.albums.ensure({ id: `a${n}`, kind: 'FLASH', refId: `convite${n}`, title: null, placeName: null, startedAt: at(w, -1), createdAt: w.clock.now() });
    await w.albums.addMembers(album.id, [caio, other], w.clock.now());
  };
  // Encontros repetidos com a mesma pessoa não somam.
  for (let n = 0; n < 6; n += 1) await meet(friends[0]!, n);
  for (let i = 1; i < NOW_MIN_PEOPLE - 1; i += 1) await meet(friends[i]!, 10 + i);
  assert.deepEqual(await badgesOf(w, caio, 'caio'), []);
  await meet(friends[NOW_MIN_PEOPLE - 1]!, 99);
  assert.deepEqual(await badgesOf(w, caio, 'caio'), ['NOW:5']);
  w.users.users.get(friends[0]!)!.status = 'SUSPENDED';
  assert.deepEqual(await badgesOf(w, caio, 'caio'), [], 'conta suspensa sai da conta');
});

test('selos: esconder some para os outros e fica marcado no próprio perfil; visitantes usam a contagem guardada', async () => {
  const w = makeWorld();
  const caio = (await w.signUp('caio')).user.id;
  const visitor = (await w.signUp('visita')).user.id;
  const friends = Object.values(await w.signUpMany(...names('amigo', NOW_MIN_PEOPLE + 1))) as string[];
  for (const [n, f] of friends.slice(0, NOW_MIN_PEOPLE).entries()) {
    const album = await w.albums.ensure({ id: `a${n}`, kind: 'FLASH', refId: `c${n}`, title: null, placeName: null, startedAt: at(w, -1), createdAt: w.clock.now() });
    await w.albums.addMembers(album.id, [caio, f], w.clock.now());
  }
  const session = { userId: caio, role: 'USER' as const };
  assert.deepEqual(await badgesOf(w, visitor, 'caio'), ['NOW:5']);
  assert.deepEqual(await w.core.badges.setHidden(session, 'NOW', true), { id: 'NOW', hidden: true });
  assert.deepEqual(await badgesOf(w, visitor, 'caio'), []);
  assert.deepEqual(await badgesOf(w, caio, 'caio'), ['NOW:5:hidden']);
  await w.core.badges.setHidden(session, 'NOW', false);

  // O visitante vê a contagem guardada até ela vencer.
  const album = await w.albums.ensure({ id: 'a-extra', kind: 'FLASH', refId: 'c-extra', title: null, placeName: null, startedAt: at(w, -1), createdAt: w.clock.now() });
  await w.albums.addMembers(album.id, [caio, friends.at(-1)!], w.clock.now());
  assert.deepEqual(await badgesOf(w, visitor, 'caio'), ['NOW:5']);
  w.clock.tick(BADGE_CACHE_MS + 1000);
  assert.deepEqual(await badgesOf(w, visitor, 'caio'), ['NOW:6']);

  await rejectsWith(w.core.badges.setHidden(session, 'NADA', true), 'NOT_FOUND');
  await rejectsWith(w.core.badges.setHidden(session, 'NOW', 'sim'), 'VALIDATION');
  // O selo de convite usa a mesma chave de sempre.
  await w.core.badges.setHidden(session, 'REFERRAL', true);
  assert.equal((await w.core.referrals.overview(session)).badgeHidden, true);
});
