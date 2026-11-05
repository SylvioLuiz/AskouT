import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLASH_MATCH_MESSAGE } from './flash-service.ts';
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

test('turnOn: só um NOW por vez; depois de desligar ou expirar liga de novo', async () => {
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

test('listAvailable: exige NOW ligado e só mostra amigos com NOW ligado', async () => {
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

test('invite: só amigo com NOW ligado; sem NOW próprio não convida; sem duplicar', async () => {
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

test('invite: vale 15 minutos e nunca passa do fim de um dos NOW', async () => {
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

test('respond: só quem recebeu responde; aceitar exige os dois NOW ligados', async () => {
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

test('desligar o NOW encerra o encontro e apaga as posições dos dois', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, GPS);
  await w.core.flash.shareLocation(bia, inviteId, GPS);
  assert.equal(w.flash.positions.size, 2);
  await w.core.flash.turnOff(ana);
  assert.equal(w.flash.positions.size, 0);
  await rejectsWith(w.core.flash.getMatch(bia, inviteId), 'NOT_FOUND');
  await rejectsWith(w.core.flash.shareLocation(bia, inviteId, GPS), 'NOT_FOUND');
});

test('o encontro acaba quando o NOW de um dos dois expira', async () => {
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

test('visibilidade: ocultar o NOW dela e não deixar ela me ver, cada um no seu sentido', async () => {
  const { w, ana, bia } = await pair();
  assert.deepEqual(await w.core.flash.visibility(ana, bia), { hideTheirs: false, hideMine: false });
  assert.equal((await w.core.flash.listAvailable(ana)).length, 1);

  // Ana oculta o Flash da Bia: Ana não vê Bia, e Bia continua vendo Ana.
  assert.deepEqual(await w.core.flash.setVisibility(ana, bia, { hideTheirs: true }), { hideTheirs: true, hideMine: false });
  assert.equal((await w.core.flash.listAvailable(ana)).length, 0);
  assert.equal((await w.core.flash.listAvailable(bia)).length, 1);
  await rejectsWith(w.core.flash.invite(ana, bia), 'CONFLICT');
  await rejectsWith(w.core.flash.invite(bia, ana), 'CONFLICT'); // Ana ocultou Bia: Bia não convida Ana
  assert.deepEqual(await w.core.flash.visibility(bia, ana), { hideTheirs: false, hideMine: false }, 'Bia não vê as escolhas da Ana');

  // Ana também não deixa a Bia vê-la.
  assert.deepEqual(await w.core.flash.setVisibility(ana, bia, { hideMine: true }), { hideTheirs: true, hideMine: true });
  assert.equal((await w.core.flash.listAvailable(bia)).length, 0);

  // A escolha da Bia é só dela: não mexe na da Ana.
  await w.core.flash.setVisibility(bia, ana, { hideTheirs: true });
  assert.deepEqual(await w.core.flash.visibility(ana, bia), { hideTheirs: true, hideMine: true });
  await w.core.flash.setVisibility(bia, ana, { hideTheirs: false });

  // Desfazer volta tudo ao normal.
  await w.core.flash.setVisibility(ana, bia, { hideTheirs: false, hideMine: false });
  assert.equal((await w.core.flash.listAvailable(ana)).length, 1);
  assert.equal((await w.core.flash.listAvailable(bia)).length, 1);
  const again = await w.core.flash.invite(ana, bia);
  assert.ok(again.id);
});

test('visibilidade: ocultar cancela convite aberto e valida o pedido', async () => {
  const { w, ana, bia } = await pair();
  await w.core.flash.invite(ana, bia);
  await w.core.flash.setVisibility(bia, ana, { hideMine: true });
  const invites = await w.core.flash.listInvites(ana);
  assert.equal(invites.sent.length + invites.received.length, 0);
  await rejectsWith(w.core.flash.setVisibility(ana, ana, { hideTheirs: true }), 'VALIDATION');
  await rejectsWith(w.core.flash.setVisibility(ana, bia, { hideTheirs: 'sim' }), 'VALIDATION');
  await rejectsWith(w.core.flash.setVisibility(ana, '00000000-0000-4000-8000-000000000000', { hideTheirs: true }), 'NOT_FOUND');
});

test('aceitar o convite deixa uma mensagem de sistema na conversa, para o botão de sugerir lugar', async () => {
  const { w, ana, bia } = await pair();
  const invite = await w.core.flash.invite(ana, bia);
  const answer = await w.core.flash.respond(bia, invite.id, 'accept');
  const chat = await w.core.conversations.messages(ana, answer.conversationId!);
  const last = chat.messages.at(-1)!;
  assert.equal(last.kind, 'SYSTEM');
  assert.equal(last.body, FLASH_MATCH_MESSAGE);
});

test('activeIds: eu e amigos com NOW ligado, sem ocultos e sem depender do meu NOW', async () => {
  const { w, ana, bia, caio } = await pair();
  await w.core.flash.turnOn(caio, { hours: 1 });
  assert.deepEqual((await w.core.flash.activeIds(ana)).sort(), [ana, bia].sort(), 'Caio não é amigo, não aparece');
  await w.core.flash.turnOff(ana);
  assert.deepEqual(await w.core.flash.activeIds(ana), [bia], 'com o meu desligado ainda vejo a Bia');
  await w.core.flash.setVisibility(ana, bia, { hideTheirs: true });
  assert.deepEqual(await w.core.flash.activeIds(ana), []);
  assert.deepEqual(await w.core.flash.activeIds(bia), [bia], 'Bia ainda vê a si mesma; Ana está desligada');
  await w.core.flash.turnOn(ana, { hours: 1 });
  await w.core.flash.setVisibility(ana, bia, { hideTheirs: false, hideMine: true });
  assert.deepEqual(await w.core.flash.activeIds(bia), [bia], 'Ana me ocultou: não vejo o raio dela');
  w.clock.tick(2 * 60 * 60 * 1000);
  assert.deepEqual(await w.core.flash.activeIds(ana), [], 'expirou');
});

test('lugar do encontro: um escolhe, o outro vê e é avisado; qualquer um troca ou tira; longe demais é recusado', async () => {
  const { w, ana, bia, caio, inviteId } = await matched();
  await w.core.flash.shareLocation(ana, inviteId, { lat: -23.55, lng: -46.63 });
  await w.core.flash.shareLocation(bia, inviteId, { lat: -23.56, lng: -46.64 });
  assert.equal((await w.core.flash.getMatch(ana, inviteId)).destination, null);
  await rejectsWith(w.core.flash.chooseDestination(caio, inviteId, { name: 'Bar', lat: -23.555, lng: -46.635 }), 'NOT_FOUND');
  await rejectsWith(w.core.flash.chooseDestination(ana, inviteId, { name: '', lat: -23.555, lng: -46.635 }), 'VALIDATION');
  await rejectsWith(w.core.flash.chooseDestination(ana, inviteId, { name: 'x'.repeat(121), lat: -23.555, lng: -46.635 }), 'VALIDATION');
  await rejectsWith(w.core.flash.chooseDestination(ana, inviteId, { name: 'Bar', lat: 95, lng: -46.635 }), 'VALIDATION');
  await rejectsWith(w.core.flash.chooseDestination(ana, inviteId, { name: 'Bar no Rio', lat: -22.9, lng: -43.2 }), 'VALIDATION');

  await w.core.flash.chooseDestination(ana, inviteId, { name: ' Bar do Zé ', lat: -23.555, lng: -46.635 });
  const mine = (await w.core.flash.getMatch(ana, inviteId)).destination!;
  const theirs = (await w.core.flash.getMatch(bia, inviteId)).destination!;
  assert.equal(mine.name, 'Bar do Zé');
  assert.equal(mine.chosenByMe, true);
  assert.equal(theirs.chosenByMe, false);
  assert.ok((await w.core.notifications.list(bia)).items.some((n) => n.title.includes('escolheu um lugar')));

  await w.core.flash.chooseDestination(bia, inviteId, { name: 'Outro Bar', lat: -23.556, lng: -46.636 });
  assert.equal((await w.core.flash.getMatch(ana, inviteId)).destination!.name, 'Outro Bar');
  assert.equal((await w.core.flash.getMatch(ana, inviteId)).destination!.chosenByMe, false);

  await w.core.flash.clearDestination(ana, inviteId);
  assert.equal((await w.core.flash.getMatch(bia, inviteId)).destination, null);
});

test('rotas do encontro: precisa de lugar escolhido; usa o serviço de rotas e cai na linha reta se ele falhar', async () => {
  const line: [number, number][] = [[-46.63, -23.55], [-46.635, -23.555]];
  const calls: string[] = [];
  const w = makeWorld({
    routes: {
      async route(from, _to, mode) {
        calls.push(mode);
        return from.lat === -23.55 ? { distanceM: 900, durationS: 700, line } : undefined;
      },
    },
  });
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  await w.core.flash.turnOn(ana!, { hours: 2 });
  await w.core.flash.turnOn(bia!, { hours: 2 });
  const invite = await w.core.flash.invite(ana!, bia!);
  await w.core.flash.respond(bia!, invite.id, 'accept');
  await w.core.flash.shareLocation(ana!, invite.id, { lat: -23.55, lng: -46.63 });
  await w.core.flash.shareLocation(bia!, invite.id, { lat: -23.56, lng: -46.64 });
  await rejectsWith(w.core.flash.routes(ana!, invite.id, 'foot'), 'CONFLICT');
  await w.core.flash.chooseDestination(ana!, invite.id, { name: 'Bar', lat: -23.555, lng: -46.635 });

  const r = await w.core.flash.routes(ana!, invite.id, 'foot');
  assert.equal(r.mode, 'foot');
  assert.deepEqual(r.me, { distanceM: 900, durationS: 700, line });
  // Bia: o serviço falhou, então vem a distância em linha reta e tempo estimado, sem trajeto.
  assert.equal(r.them!.line, null);
  assert.ok(r.them!.distanceM > 500 && r.them!.durationS > 0);
  assert.equal((await w.core.flash.routes(ana!, invite.id, 'driving')).mode, 'driving');
  assert.ok(calls.includes('driving'));
  // Os dois veem a mesma coisa, cada um do seu ponto de vista.
  const fromBia = await w.core.flash.routes(bia!, invite.id, 'foot');
  assert.equal(fromBia.them!.distanceM, 900);
});

// ---------- Ordem de "Livres agora" e estender ----------

async function crowd() {
  const w = makeWorld();
  const { ana, perto, longe, papo } = await w.signUpMany('ana', 'perto', 'longe', 'papo');
  for (const f of [perto!, longe!, papo!]) await befriend(w, ana!, f);
  // Praça da Liberdade (BH); "perto" a ~1 km, "papo" a ~5 km, "longe" a ~15 km.
  await w.core.flash.turnOn(ana!, { hours: 2, lat: -19.9320, lng: -43.9380 });
  await w.core.flash.turnOn(perto!, { hours: 2, lat: -19.9400, lng: -43.9350 });
  await w.core.flash.turnOn(papo!, { hours: 2, lat: -19.8900, lng: -43.9500 });
  await w.core.flash.turnOn(longe!, { hours: 2, lat: -19.8000, lng: -43.9600 });
  // Ana conversa bastante com "papo".
  const chat = await w.core.conversations.open(ana!, papo!);
  for (let i = 0; i < 5; i += 1) await w.core.conversations.send(ana!, chat.id, { body: `oi ${i}` });
  await w.core.conversations.send(papo!, chat.id, { body: 'bora!' });
  return { w, ana: ana!, perto: perto!, longe: longe!, papo: papo! };
}

test('livres agora: mais perto primeiro quando ligou com localização, sem revelar a posição', async () => {
  const { w, ana, perto, longe, papo } = await crowd();
  const r = await w.core.flash.listAvailableRanked(ana);
  assert.equal(r.order, 'near');
  assert.equal(r.nearAvailable, true);
  assert.deepEqual(r.items.map((i) => i.profile.userId), [perto, papo, longe]);
  const json = JSON.stringify(r);
  assert.doesNotMatch(json, /-19\.|-43\.|area|lat|lng/i, 'a posição nunca sai na resposta');
  // Só a distância e o tempo aproximados (das regiões arredondadas: "perto" dá ~1,5 km).
  assert.deepEqual(r.items.map((i) => i.approx), [
    { km: 2, minutes: 20, mode: 'walk' },
    { km: 5, minutes: 15, mode: 'car' },
    { km: 15, minutes: 40, mode: 'car' },
  ]);
});

test('distância aproximada: a pé até 2 km, de carro acima; minutos de 5 em 5', async () => {
  const { approxTrip } = await import('./flash-service.ts');
  assert.deepEqual(approxTrip(400), { km: 0, minutes: 5, mode: 'walk' });
  assert.deepEqual(approxTrip(1800), { km: 2, minutes: 20, mode: 'walk' });
  assert.deepEqual(approxTrip(3000), { km: 3, minutes: 10, mode: 'car' });
  assert.deepEqual(approxTrip(12_400), { km: 12, minutes: 35, mode: 'car' });
});

test('livres agora: ordem de interação põe primeiro com quem você mais fala', async () => {
  const { w, ana, papo } = await crowd();
  const r = await w.core.flash.listAvailableRanked(ana, 'interaction');
  assert.equal(r.order, 'interaction');
  assert.equal(r.items[0]?.profile.userId, papo);
});

test('livres agora: sem localização, a ordem é por interação e quem não informou vai para o fim do "perto"', async () => {
  const w = makeWorld();
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await befriend(w, ana!, bia!);
  await befriend(w, ana!, caio!);
  await w.core.flash.turnOn(ana!, { hours: 1 });
  await w.core.flash.turnOn(bia!, { hours: 1, lat: -23.5, lng: -46.6 });
  await w.core.flash.turnOn(caio!, { hours: 1 });
  const r = await w.core.flash.listAvailableRanked(ana!, 'near');
  assert.equal(r.order, 'interaction', 'sem a minha localização não dá para ordenar por distância');
  assert.equal(r.nearAvailable, false);
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((i) => i.approx === null), 'sem a minha localização, sem distância');
  await rejectsWith(w.core.flash.turnOn(caio!, { hours: 1, lat: 200, lng: 0 }), 'VALIDATION');
});

test('localização do NOW: arredondada para ~1 km e apagada ao desligar', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await w.core.flash.turnOn(ana!, { hours: 1, lat: -19.932178, lng: -43.938011 });
  const session = [...w.flash.sessions.values()].find((s) => s.userId === ana);
  assert.deepEqual(session?.area, { lat: -19.93, lng: -43.94 });
  await w.core.flash.turnOff(ana!);
  assert.equal([...w.flash.sessions.values()].find((s) => s.userId === ana)?.area, null);
});

test('estender o NOW: +30 min ou +1 h, no máximo 3 horas a partir de agora', async () => {
  const w = makeWorld();
  const { ana } = await w.signUpMany('ana');
  await rejectsWith(w.core.flash.extend(ana!, { minutes: 30 }), 'FORBIDDEN');
  const on = await w.core.flash.turnOn(ana!, { hours: 1 });
  const start = new Date(on.expiresAt!).getTime();
  await rejectsWith(w.core.flash.extend(ana!, { minutes: 45 }), 'VALIDATION');
  const plus30 = await w.core.flash.extend(ana!, { minutes: 30 });
  assert.equal(new Date(plus30.expiresAt!).getTime() - start, 30 * 60_000);
  const plus60 = await w.core.flash.extend(ana!, { minutes: 60 });
  assert.equal(new Date(plus60.expiresAt!).getTime() - start, 90 * 60_000);
  const capped = await w.core.flash.extend(ana!, { minutes: 60 });
  assert.equal(new Date(capped.expiresAt!).getTime(), w.clock.now().getTime() + 180 * 60_000, 'para nas 3 horas');
  await rejectsWith(w.core.flash.extend(ana!, { minutes: 30 }), 'CONFLICT');
  assert.equal((await w.core.flash.status(ana!)).expiresAt, capped.expiresAt);
});

test('localização aproximada: quem escolhe "aproximada" ao aceitar só mostra a posição arredondada', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  await w.core.flash.turnOn(ana!, { hours: 1 });
  await w.core.flash.turnOn(bia!, { hours: 1 });
  const invite = await w.core.flash.invite(ana!, bia!);
  await w.core.flash.respond(bia!, invite.id, 'accept', { approx: true });
  await w.core.flash.shareLocation(bia!, invite.id, { lat: -23.523456, lng: -46.187654, accuracyM: 12 });
  await w.core.flash.shareLocation(ana!, invite.id, { lat: -23.551234, lng: -46.633321, accuracyM: 8 });
  const fromAna = await w.core.flash.getMatch(ana!, invite.id);
  assert.equal(fromAna.themApprox, true);
  assert.equal(fromAna.meApprox, false);
  assert.deepEqual([fromAna.them?.lat, fromAna.them?.lng, fromAna.them?.accuracyM], [-23.525, -46.2, 3000]);
  assert.deepEqual([fromAna.me?.lat, fromAna.me?.lng], [-23.551234, -46.633321], 'quem escolheu exata continua exata');
  const fromBia = await w.core.flash.getMatch(bia!, invite.id);
  assert.equal(fromBia.meApprox, true);
});

test('localização aproximada: dá para escolher ao convidar e trocar durante o encontro', async () => {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await befriend(w, ana!, bia!);
  await w.core.flash.turnOn(ana!, { hours: 1 });
  await w.core.flash.turnOn(bia!, { hours: 1 });
  const invite = await w.core.flash.invite(ana!, bia!, { approx: true });
  await w.core.flash.respond(bia!, invite.id, 'accept');
  await w.core.flash.shareLocation(ana!, invite.id, { lat: -23.551234, lng: -46.633321, accuracyM: 8 });
  assert.equal((await w.core.flash.getMatch(bia!, invite.id)).them?.lat, -23.55);
  // Ana passa a mostrar a exata; Bia passa a mostrar a aproximada e a posição já guardada é arredondada.
  await w.core.flash.shareLocation(bia!, invite.id, { lat: -23.523456, lng: -46.187654 });
  assert.deepEqual(await w.core.flash.setPrecision(ana!, invite.id, false), { approx: false });
  await w.core.flash.shareLocation(ana!, invite.id, { lat: -23.551234, lng: -46.633321 });
  assert.equal((await w.core.flash.getMatch(bia!, invite.id)).them?.lat, -23.551234);
  await w.core.flash.setPrecision(bia!, invite.id, true);
  assert.equal((await w.core.flash.getMatch(ana!, invite.id)).them?.lat, -23.525);
  await rejectsWith(w.core.flash.setPrecision(bia!, invite.id, 'sim'), 'VALIDATION');
});
