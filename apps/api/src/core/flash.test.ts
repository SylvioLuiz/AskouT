import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

type World = ReturnType<typeof makeWorld>;

async function befriend(w: World, a: string, b: string) {
  await w.core.follows.follow(a, b);
  await w.core.follows.follow(b, a);
}

/** Dois amigos com Flash ligado. */
async function pair() {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  await w.core.flash.turnOn(ana!, { hours: 2 });
  await w.core.flash.turnOn(bia!, { hours: 2, note: 'chopp?' });
  return { w, ana: ana!, bia: bia!, caio: caio! };
}

/** Ana convida, Bia aceita. */
async function matched() {
  const p = await pair();
  const invite = await p.w.core.flash.invite(p.ana, p.bia);
  await p.w.core.flash.respond(p.bia, invite.id, 'accept');
  return { ...p, inviteId: invite.id };
}

const GPS = { lat: -23.5505, lng: -46.6333, accuracyM: 12 };

test('turnOn: só 1, 2 ou 3 horas; recado opcional com limite', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  for (const bad of [0, 4, 1.5, '2', undefined, null]) {
    const err = await rejectsWith(w.core.flash.turnOn(ana!, { hours: bad }), 'VALIDATION');
    assert.ok(err.details && 'hours' in err.details);
  }
  const err = await rejectsWith(w.core.flash.turnOn(ana!, { hours: 1, note: 'x'.repeat(61) }), 'VALIDATION');
  assert.ok(err.details && 'note' in err.details);
  await rejectsWith(w.core.flash.turnOn(ana!, { hours: 1, note: 'a\u0000b' }), 'VALIDATION');

  const on = await w.core.flash.turnOn(ana!, { hours: 3, note: '  bora  ' });
  assert.equal(on.active, true);
  assert.equal(on.note, 'bora');
  assert.equal(Date.parse(on.expiresAt!) - w.clock.now().getTime(), 3 * 3_600_000);
});

test('turnOn: só um Flash por vez; depois de desligar ou expirar liga de novo', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await w.core.flash.turnOn(ana!, { hours: 1 });
  await rejectsWith(w.core.flash.turnOn(ana!, { hours: 2 }), 'CONFLICT');
  assert.deepEqual(await w.core.flash.turnOff(ana!), { ended: true });
  assert.deepEqual(await w.core.flash.turnOff(ana!), { ended: false }, 'desligar é idempotente');
  assert.equal((await w.core.flash.status(ana!)).active, false);
  await w.core.flash.turnOn(ana!, { hours: 1 });
  w.clock.tick(61 * 60 * 1000); // passou 1 h: expirou sozinho
  assert.equal((await w.core.flash.status(ana!)).active, false);
  await w.core.flash.turnOn(ana!, { hours: 1 });
  assert.equal((await w.core.flash.status(ana!)).active, true);
});

test('listAvailable: exige Flash ligado e só mostra amigos com Flash ligado', async () => {
  const { w, ana, bia, caio } = await pair();
  await w.core.flash.turnOn(caio, { hours: 1 }); // caio liga, mas não é amigo de ana
  const list = await w.core.flash.listAvailable(ana);
  assert.deepEqual(list.map((i) => i.profile.username), ['bia']);
  assert.equal(list[0]!.note, 'chopp?');
  assert.equal(list[0]!.invite, null);
  assert.ok(!JSON.stringify(list).match(/lat|lng|position/i), 'a lista nunca traz localização');

  await w.core.flash.turnOff(ana);
  await rejectsWith(w.core.flash.listAvailable(ana), 'FORBIDDEN'); // sem Flash, sem lista
  void bia;
});

test('listAvailable: amigo que expirou ou bloqueou some da lista', async () => {
  const { w, ana, bia } = await pair();
  assert.equal((await w.core.flash.listAvailable(ana)).length, 1);
  await w.core.blocks.block(bia, ana);
  assert.equal((await w.core.flash.listAvailable(ana)).length, 0);
});

test('invite: só amigo com Flash ligado; sem Flash próprio não convida; sem duplicar', async () => {
  const { w, ana, bia, caio } = await pair();
  await rejectsWith(w.core.flash.invite(ana, ana), 'VALIDATION');
  await w.core.flash.turnOn(caio, { hours: 1 });
  await rejectsWith(w.core.flash.invite(ana, caio), 'FORBIDDEN'); // não é amigo
  await w.core.flash.turnOff(bia);
  await rejectsWith(w.core.flash.invite(ana, bia), 'CONFLICT'); // amigo sem Flash
  await w.core.flash.turnOn(bia, { hours: 2 });

  await w.core.flash.turnOff(ana);
  await rejectsWith(w.core.flash.invite(ana, bia), 'FORBIDDEN'); // eu sem Flash
  await w.core.flash.turnOn(ana, { hours: 2 });

  const invite = await w.core.flash.invite(ana, bia);
  assert.equal(invite.direction, 'SENT');
  assert.equal(invite.other.username, 'bia');
  await rejectsWith(w.core.flash.invite(ana, bia), 'CONFLICT');
  await rejectsWith(w.core.flash.invite(bia, ana), 'CONFLICT', ); // já há convite no outro sentido
});

test('invite: vale 15 minutos e nunca passa do fim de um dos Flash', async () => {
  const { w, ana, bia } = await pair();
  const invite = await w.core.flash.invite(ana, bia);
  assert.equal(Date.parse(invite.expiresAt) - w.clock.now().getTime(), 15 * 60_000);
  w.clock.tick(16 * 60_000);
  await rejectsWith(w.core.flash.respond(bia, invite.id, 'accept'), 'NOT_FOUND');
  assert.deepEqual((await w.core.flash.listInvites(bia)).received, []);
  // depois de vencido pode convidar de novo
  await w.core.flash.invite(ana, bia);

  const short = makeWorld();
  const { dedo: a, duda: b } = await short.signUpMany('dedo', 'duda');
  await befriend(short, a!, b!);
  await short.core.flash.turnOn(a!, { hours: 3 });
  await short.core.flash.turnOn(b!, { hours: 1 });
  short.clock.tick(50 * 60_000); // falta 10 min para o Flash do b acabar
  const i2 = await short.core.flash.invite(a!, b!);
  assert.equal(Date.parse(i2.expiresAt) - short.clock.now().getTime(), 10 * 60_000);
});

test('respond: só quem recebeu responde; aceitar exige os dois Flash ligados', async () => {
  const { w, ana, bia, caio } = await pair();
  const invite = await w.core.flash.invite(ana, bia);
  await rejectsWith(w.core.flash.respond(ana, invite.id, 'accept'), 'NOT_FOUND'); // quem enviou não aceita
  await rejectsWith(w.core.flash.respond(caio, invite.id, 'accept'), 'NOT_FOUND'); // estranho
  await rejectsWith(w.core.flash.respond(bia, invite.id, 'talvez'), 'VALIDATION');
  await rejectsWith(w.core.flash.respond(bia, 'nao-existe', 'accept'), 'NOT_FOUND');

  await w.core.flash.turnOff(bia); // quem recebeu desligou: o convite já foi cancelado
  await rejectsWith(w.core.flash.respond(bia, invite.id, 'accept'), 'NOT_FOUND');
});

test('respond: aceitar ou recusar muda o convite e o aceito vira encontro', async () => {
  const { w, ana, bia } = await pair();
  const invite = await w.core.flash.invite(ana, bia);
  const overview = await w.core.flash.listInvites(bia);
  assert.equal(overview.received.length, 1);
  assert.equal(overview.received[0]!.direction, 'RECEIVED');
  assert.equal((await w.core.flash.listInvites(ana)).sent.length, 1);

  const accepted = await w.core.flash.respond(bia, invite.id, 'accept');
  assert.equal(accepted.status, 'ACCEPTED');
  assert.ok(accepted.conversationId);
  assert.equal((await w.core.flash.listInvites(ana)).matches.length, 1);
  assert.equal((await w.core.flash.listInvites(bia)).matches[0]!.direction, 'MATCHED');
  await rejectsWith(w.core.flash.respond(bia, invite.id, 'accept'), 'NOT_FOUND'); // já respondido

  const w2 = await pair();
  const i2 = await w2.w.core.flash.invite(w2.ana, w2.bia);
  assert.deepEqual(await w2.w.core.flash.respond(w2.bia, i2.id, 'decline'), { status: 'DECLINED', conversationId: null });
  assert.deepEqual(await w2.w.core.flash.listInvites(w2.ana), { received: [], sent: [], matches: [] });
  await w2.w.core.flash.invite(w2.ana, w2.bia); // depois de recusado pode convidar de novo
});

test('end: cancelar, recusar e encerrar encontro; idempotente e só para participantes', async () => {
  const { w, ana, bia, caio } = await pair();
  const invite = await w.core.flash.invite(ana, bia);
  await rejectsWith(w.core.flash.end(caio, invite.id), 'NOT_FOUND');
  assert.deepEqual(await w.core.flash.end(ana, invite.id), { ended: true }); // cancelou
  assert.deepEqual(await w.core.flash.end(ana, invite.id), { ended: false });
  assert.equal((await w.core.flash.listInvites(bia)).received.length, 0);
});

test('localização: só em encontro aceito, só dos dois participantes', async () => {
  const { w, ana, bia, caio, inviteId } = await matched();
  await rejectsWith(w.core.flash.shareLocation(caio, inviteId, GPS), 'NOT_FOUND');
  await rejectsWith(w.core.flash.getMatch(caio, inviteId), 'NOT_FOUND');

  // convite apenas pendente não compartilha nada
  const p = await pair();
  const pending = await p.w.core.flash.invite(p.ana, p.bia);
  await rejectsWith(p.w.core.flash.shareLocation(p.ana, pending.id, GPS), 'NOT_FOUND');
  await rejectsWith(p.w.core.flash.getMatch(p.bia, pending.id), 'NOT_FOUND');

  await w.core.flash.shareLocation(ana, inviteId, GPS);
  // Bia ainda não compartilhou: vê que Ana está no encontro, mas a posição dela é a única que existe
  const seenByBia = await w.core.flash.getMatch(bia, inviteId);
  assert.equal(seenByBia.other.username, 'ana');
  assert.equal(seenByBia.them!.lat, GPS.lat);
  assert.equal(seenByBia.me, null);
  assert.equal(seenByBia.them!.stale, false);
});

test('localização: valida coordenadas e guarda só a última posição', async () => {
  const { w, ana, inviteId } = await matched();
  for (const bad of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '1', lng: 2 }, { lat: NaN, lng: 0 }, { lat: 0 }, { lat: 0, lng: 0, accuracyM: -1 }]) {
    await rejectsWith(w.core.flash.shareLocation(ana, inviteId, bad as never), 'VALIDATION');
  }
  await w.core.flash.shareLocation(ana, inviteId, { lat: 1, lng: 2 });
  w.clock.tick(5000);
  await w.core.flash.shareLocation(ana, inviteId, { lat: 3, lng: 4, accuracyM: 8 });
  assert.equal(w.flash.positions.size, 1, 'uma linha só: sem histórico');
  const view = await w.core.flash.getMatch(ana, inviteId);
  assert.deepEqual([view.me!.lat, view.me!.lng, view.me!.accuracyM], [3, 4, 8]);
});

test('localização: posição antiga vira "sem sinal" (stale)', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  w.clock.tick(121_000);
  assert.equal((await w.core.flash.getMatch(bia, inviteId)).them!.stale, true);
});

test('desligar o Flash encerra o encontro e apaga as posições dos dois', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  await w.core.flash.shareLocation(bia, inviteId, GPS);
  assert.equal(w.flash.positions.size, 2);
  await w.core.flash.turnOff(ana);
  assert.equal(w.flash.positions.size, 0);
  await rejectsWith(w.core.flash.getMatch(bia, inviteId), 'NOT_FOUND');
  await rejectsWith(w.core.flash.shareLocation(bia, inviteId, GPS), 'NOT_FOUND');
});

test('o encontro acaba quando o Flash de um dos dois expira', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  w.clock.tick(2 * 3_600_000 + 1000);
  await rejectsWith(w.core.flash.getMatch(bia, inviteId), 'NOT_FOUND');
  await rejectsWith(w.core.flash.shareLocation(bia, inviteId, GPS), 'NOT_FOUND');
  const purged = await w.core.flash.purgeExpired();
  assert.equal(purged.invites, 1);
  assert.equal(w.flash.positions.size, 0, 'a faxina apaga a posição que ficou');
});

test('encerrar o encontro apaga as posições', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  assert.deepEqual(await w.core.flash.end(bia, inviteId), { ended: true });
  assert.equal(w.flash.positions.size, 0);
  await rejectsWith(w.core.flash.getMatch(ana, inviteId), 'NOT_FOUND');
});

test('bloquear encerra convites e encontros entre os dois e apaga a posição', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  await w.core.flash.shareLocation(bia, inviteId, GPS);
  await w.core.blocks.block(ana, bia);
  assert.equal(w.flash.positions.size, 0);
  await rejectsWith(w.core.flash.getMatch(bia, inviteId), 'NOT_FOUND');
  assert.deepEqual(await w.core.flash.listInvites(ana), { received: [], sent: [], matches: [] });
});

test('defesa: se o bloqueio existir mas a limpeza não rodou, ler o encontro encerra tudo', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  await w.blocks.add(bia, ana, w.clock.now()); // grava o bloqueio direto, sem passar pelo BlockService
  await rejectsWith(w.core.flash.getMatch(ana, inviteId), 'NOT_FOUND');
  assert.equal(w.flash.positions.size, 0);
});

test('purgeExpired remove registros fechados há mais de 24 h e mantém os recentes', async () => {
  const { w, ana, bia } = await pair();
  const invite = await w.core.flash.invite(ana, bia);
  await w.core.flash.end(ana, invite.id);
  await w.core.flash.turnOff(ana);
  assert.equal((await w.core.flash.purgeExpired()).removed, 0);
  w.clock.tick(25 * 3_600_000);
  const result = await w.core.flash.purgeExpired();
  assert.ok(result.removed >= 2);
  assert.equal(w.flash.invites.size, 0);
});

test('flash: duração livre em minutos (5 a 180, de 5 em 5)', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  for (const bad of [0, 4, 7, 185, 181, 2.5, '30', null]) {
    const err = await rejectsWith(w.core.flash.turnOn(ana!, { minutes: bad }), 'VALIDATION');
    assert.ok(err.details && 'minutes' in err.details, String(bad));
  }
  const on = await w.core.flash.turnOn(ana!, { minutes: 45 });
  const span = new Date(on.expiresAt!).getTime() - new Date(on.startsAt!).getTime();
  assert.equal(span, 45 * 60_000);
});
