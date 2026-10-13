import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

// O relógio de teste começa em 2026-10-13T12:00Z (09:00 em São Paulo).
const D = '2026-10-20'; // terça-feira da semana seguinte
const at = (hm: string) => `${D}T${hm}:00-03:00`;
const slot = (start: string, end: string, state = 'AVAILABLE') => ({ start: at(start), end: at(end), state });

test('addSlot: grava e devolve o horário em UTC', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  const view = await w.core.availability.addSlot(ana!, slot('19:00', '23:00'));
  assert.equal(view.start, '2026-10-20T22:00:00.000Z');
  assert.equal(view.end, '2026-10-21T02:00:00.000Z');
  assert.equal(view.state, 'AVAILABLE');
  const list = await w.core.availability.listMine(ana!, `${D}T00:00:00-03:00`, '2026-10-21T00:00:00-03:00');
  assert.equal(list.length, 1);
});

test('addSlot: validações com mensagem por campo', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  const bad = async (input: object, field: string) => {
    const err = await rejectsWith(w.core.availability.addSlot(ana!, input), 'VALIDATION');
    assert.ok(err.details && field in err.details, `esperava erro em ${field}, veio ${JSON.stringify(err.details)}`);
  };
  await bad({ ...slot('19:00', '23:00'), state: 'TALVEZ' }, 'state');
  await bad({ ...slot('19:00', '23:00'), state: undefined }, 'state');
  await bad({ start: '2026-10-20 19:00', end: at('23:00'), state: 'AVAILABLE' }, 'start'); // sem fuso
  await bad({ start: at('19:00'), end: 12345, state: 'AVAILABLE' }, 'end');
  await bad(slot('23:00', '19:00'), 'end'); // fim antes do início
  await bad(slot('19:00', '19:00'), 'end');
  await bad({ start: `${D}T00:00:00-03:00`, end: '2026-10-21T03:00:00-03:00', state: 'AVAILABLE' }, 'end'); // mais de 24 h
  await bad({ start: '2026-10-12T19:00:00-03:00', end: '2026-10-12T23:00:00-03:00', state: 'AVAILABLE' }, 'start'); // já passou
  await bad({ start: '2030-01-01T19:00:00-03:00', end: '2030-01-01T23:00:00-03:00', state: 'AVAILABLE' }, 'start'); // longe demais
});

test('addSlot: horários que se sobrepõem são recusados; encostar pode', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await w.core.availability.addSlot(ana!, slot('19:00', '22:00'));
  await rejectsWith(w.core.availability.addSlot(ana!, slot('21:00', '23:00', 'UNAVAILABLE')), 'CONFLICT');
  await w.core.availability.addSlot(ana!, slot('22:00', '23:00', 'UNAVAILABLE'));
});

test('addSlot: respeita o limite de horários ativos', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  for (let i = 0; i < 300; i += 1) {
    // fabrica horários distintos direto no repositório (mais rápido que 300 chamadas validadas)
    await w.availability.add({
      id: `s${i}`,
      userId: ana!,
      startsAt: new Date(Date.parse('2026-11-01T00:00:00Z') + i * 3_600_000),
      endsAt: new Date(Date.parse('2026-11-01T00:00:00Z') + i * 3_600_000 + 1_800_000),
      state: 'AVAILABLE',
      createdAt: w.clock.now(),
    });
  }
  await rejectsWith(w.core.availability.addSlot(ana!, slot('19:00', '22:00')), 'CONFLICT');
});

test('removeSlot: só o dono remove; apagar o alheio não revela nada', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  const view = await w.core.availability.addSlot(ana!, slot('19:00', '22:00'));
  assert.deepEqual(await w.core.availability.removeSlot(bia!, view.id), { removed: false });
  assert.equal((await w.availability.listForUsers([ana!], new Date(0), new Date(9e12))).length, 1);
  assert.deepEqual(await w.core.availability.removeSlot(ana!, view.id), { removed: true });
  assert.deepEqual(await w.core.availability.removeSlot(ana!, view.id), { removed: false });
});

test('listMine: período inválido ou grande demais é recusado', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await rejectsWith(w.core.availability.listMine(ana!, 'ontem', 'hoje'), 'VALIDATION');
  await rejectsWith(w.core.availability.listMine(ana!, at('10:00'), at('09:00')), 'VALIDATION');
  await rejectsWith(w.core.availability.listMine(ana!, '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z'), 'VALIDATION');
});

test('listFriend: só amigos veem; seguir sozinho, bloqueio e estranho não bastam', async () => {
  const w = makeWorld();
  const { ana, bia, caio, dani } = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  await w.core.availability.addSlot(bia!, slot('19:00', '22:00'));
  const range = [`${D}T00:00:00-03:00`, '2026-10-21T00:00:00-03:00'] as const;

  await rejectsWith(w.core.availability.listFriend(ana!, bia!, ...range), 'FORBIDDEN'); // estranhos
  await w.core.follows.follow(ana!, bia!);
  await rejectsWith(w.core.availability.listFriend(ana!, bia!, ...range), 'FORBIDDEN'); // só um lado segue
  await w.core.follows.follow(bia!, ana!);
  const seen = await w.core.availability.listFriend(ana!, bia!, ...range);
  assert.equal(seen.profile.username, 'bia');
  assert.equal(seen.slots.length, 1);

  await w.core.blocks.block(bia!, ana!);
  await rejectsWith(w.core.availability.listFriend(ana!, bia!, ...range), 'FORBIDDEN');

  await rejectsWith(w.core.availability.listFriend(caio!, caio!, ...range), 'FORBIDDEN'); // a si mesmo pelo caminho de amigos
  void dani;
});

test('compatibility: verde, laranja, vermelho e aguardando seguem as regras confirmadas', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  await befriend(w, ana!, caio!);
  const q = { friendIds: [bia!, caio!], start: at('20:00'), end: at('22:00') };

  // ninguém informou nada -> aguardando
  assert.equal((await w.core.availability.compatibility(ana!, q)).level, 'awaiting');

  await w.core.availability.addSlot(ana!, slot('19:00', '23:00'));
  await w.core.availability.addSlot(bia!, slot('19:00', '23:00'));
  // caio sem informação continua "aguardando", nunca "indisponível"
  const waiting = await w.core.availability.compatibility(ana!, q);
  assert.equal(waiting.level, 'awaiting');
  assert.equal(waiting.participants.find((p) => p.profile.username === 'caio')!.status, 'unknown');

  await w.core.availability.addSlot(caio!, slot('19:00', '23:00'));
  const green = await w.core.availability.compatibility(ana!, q);
  assert.equal(green.level, 'green');
  assert.equal(green.counts.available, 3);
  assert.equal(green.participants.find((p) => p.isMe)!.profile.username, 'ana');
  assert.equal(green.participants.length, 3);
  assert.ok(green.participants.every((p) => !('reason' in p)), 'o motivo não sai do servidor');
});

test('compatibility: indisponibilidade manual vale mais que disponibilidade; vermelho e laranja', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  await befriend(w, ana!, caio!);
  const q = { friendIds: [bia!, caio!], start: at('20:00'), end: at('22:00') };

  await w.core.availability.addSlot(ana!, slot('19:00', '20:30', 'AVAILABLE'));
  await w.core.availability.addSlot(ana!, slot('20:30', '23:00', 'AVAILABLE'));
  await w.core.availability.addSlot(bia!, slot('19:00', '23:00'));
  await w.core.availability.addSlot(caio!, slot('21:00', '21:30', 'UNAVAILABLE'));
  await w.core.availability.addSlot(caio!, slot('19:00', '21:00')); // não conflita: encosta
  // ana ok, bia ok, caio indisponível dentro do intervalo -> 2 de 3 -> laranja
  assert.equal((await w.core.availability.compatibility(ana!, q)).level, 'orange');

  // bia também fica indisponível no mesmo horário -> só ana de 3 -> vermelho
  const w2 = makeWorld();
  const p = await w2.signUpMany('ana', 'bia', 'caio');
  await befriend(w2, p.ana!, p.bia!);
  await befriend(w2, p.ana!, p.caio!);
  await w2.core.availability.addSlot(p.ana!, slot('19:00', '23:00'));
  await w2.core.availability.addSlot(p.bia!, slot('19:00', '23:00', 'UNAVAILABLE'));
  await w2.core.availability.addSlot(p.caio!, slot('21:00', '21:30', 'UNAVAILABLE'));
  await w2.core.availability.addSlot(p.caio!, slot('19:00', '21:00'));
  const red = await w2.core.availability.compatibility(p.ana!, { friendIds: [p.bia!, p.caio!], start: at('20:00'), end: at('22:00') });
  assert.equal(red.level, 'red');
  assert.equal(red.counts.unavailable, 2);
});

test('compatibility: parcial vale como meio-termo', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  await w.core.availability.addSlot(ana!, slot('19:00', '23:00'));
  await w.core.availability.addSlot(bia!, slot('19:00', '23:00', 'PARTIAL'));
  const r = await w.core.availability.compatibility(ana!, { friendIds: [bia!], start: at('20:00'), end: at('22:00') });
  assert.equal(r.level, 'orange');
  assert.equal(r.counts.partial, 1);
});

test('compatibility: só amigos; entrada validada', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  const base = { start: at('20:00'), end: at('22:00') };
  await rejectsWith(w.core.availability.compatibility(ana!, { ...base, friendIds: [bia!, caio!] }), 'FORBIDDEN');
  await rejectsWith(w.core.availability.compatibility(ana!, { ...base, friendIds: [ana!] }), 'FORBIDDEN');
  await rejectsWith(w.core.availability.compatibility(ana!, { ...base, friendIds: [] }), 'VALIDATION');
  await rejectsWith(w.core.availability.compatibility(ana!, { ...base, friendIds: 'bia' }), 'VALIDATION');
  await rejectsWith(w.core.availability.compatibility(ana!, { ...base, friendIds: Array.from({ length: 10 }, (_, i) => `x${i}`) }), 'VALIDATION');
  await rejectsWith(w.core.availability.compatibility(ana!, { friendIds: [bia!], start: at('22:00'), end: at('20:00') }), 'VALIDATION');
  // repetidos contam uma vez só
  const r = await w.core.availability.compatibility(ana!, { ...base, friendIds: [bia!, bia!] });
  assert.equal(r.counts.total, 2);
});

test('bestDates: ordena do melhor para o pior e respeita o relógio (nada no passado)', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  // os dois livres terça 20:00–23:00; só ana livre quarta
  await w.core.availability.addSlot(ana!, slot('19:00', '23:30'));
  await w.core.availability.addSlot(bia!, slot('20:00', '23:00'));
  const out = await w.core.availability.bestDates(ana!, {
    friendIds: [bia!],
    fromDate: '2026-10-13',
    toDate: '2026-10-21',
    durationMinutes: 120,
    earliestStart: '18:00',
    latestStart: '22:00',
    limit: 3,
  });
  assert.equal(out.length, 3);
  assert.equal(out[0]!.level, 'green');
  assert.equal(out[0]!.start, '2026-10-20T23:00:00.000Z'); // 20:00 em São Paulo, o mais cedo que serve aos dois
  assert.ok(out.every((r) => Date.parse(r.start) >= w.clock.now().getTime()));
  const levels = out.map((r) => r.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ['green', 'orange', 'awaiting', 'red'].indexOf(a) - ['green', 'orange', 'awaiting', 'red'].indexOf(b)));
});

test('bestDates: devolve no máximo um horário por dia', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  await w.core.availability.addSlot(ana!, slot('18:00', '23:30'));
  await w.core.availability.addSlot(bia!, slot('18:00', '23:30'));
  const out = await w.core.availability.bestDates(ana!, { friendIds: [bia!], fromDate: '2026-10-19', toDate: '2026-10-22', limit: 10 });
  const days = out.map((r) => new Date(Date.parse(r.start) - 3 * 3_600_000).toISOString().slice(0, 10));
  assert.equal(new Set(days).size, days.length, 'dias repetidos: ' + days.join(','));
  assert.equal(out.length, 4, 'um por dia nos 4 dias');
  assert.equal(out[0]!.level, 'green');
  assert.equal(days[0], '2026-10-20');
});

test('bestDates: validação e só amigos', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  const ok = { friendIds: [bia!], fromDate: '2026-10-20', toDate: '2026-10-22' };
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, friendIds: [caio!] }), 'FORBIDDEN');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, fromDate: '20/10/2026' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, fromDate: '2026-02-31' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, toDate: '2026-10-19' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, toDate: '2027-03-01' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, durationMinutes: 5 }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, durationMinutes: '120' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, limit: 100 }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, earliestStart: '25:00' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, earliestStart: '22:00', latestStart: '18:00' }), 'VALIDATION');
  await rejectsWith(w.core.availability.bestDates(ana!, { ...ok, timeZone: 'Marte/Olimpo' }), 'VALIDATION');
  const fine = await w.core.availability.bestDates(ana!, ok);
  assert.ok(fine.length > 0 && fine.length <= 5);
});
