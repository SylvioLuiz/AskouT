import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARRIVAL_MIN_INTERVAL_MS, ARRIVAL_REFRESH_MS, ArrivalTracker, arrivalProgress, estimateArrival, formatArrivalDistance } from './arrival.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

/** ~0,0009 grau de latitude ≈ 100 m. */
const north = (m: number) => ({ lat: -23.55 + m / 111_000, lng: -46.63 });
const HERE = north(0);

test('estimateArrival: a pé até 2 km, de carro acima; chegou a 80 m', () => {
  const near = estimateArrival(north(1000), HERE);
  assert.equal(near.mode, 'walk');
  assert.equal(near.arrived, false);
  assert.equal(near.minutes, Math.ceil((near.distanceM * 1.3) / 80));
  const far = estimateArrival(north(8000), HERE);
  assert.equal(far.mode, 'car');
  assert.ok(far.minutes >= 20 && far.minutes <= 30, `de carro 8 km: ${far.minutes} min`);
  const there = estimateArrival(north(50), HERE);
  assert.equal(there.arrived, true);
  assert.equal(there.minutes, 0);
});

test('arrivalProgress e distância em texto', () => {
  assert.equal(arrivalProgress(1080, 1080), 0);
  assert.equal(arrivalProgress(1080, 580), 0.5);
  assert.equal(arrivalProgress(1080, 10), 1);
  assert.equal(arrivalProgress(50, 50), 1);
  assert.equal(formatArrivalDistance(234), '230 m');
  assert.equal(formatArrivalDistance(1534), '1,5 km');
  assert.equal(formatArrivalDistance(23_400), '23 km');
});

test('ArrivalTracker: manda a primeira, segura as seguidas e sempre manda a chegada (uma vez)', () => {
  const tr = new ArrivalTracker();
  const at = (m: number) => estimateArrival(north(m), HERE);
  assert.deepEqual(tr.next('k', at(2000), 0), { progress: 0, first: true });
  assert.equal(tr.next('k', at(1500), 10_000), undefined, 'antes do intervalo mínimo');
  const later = tr.next('k', at(1000), ARRIVAL_MIN_INTERVAL_MS + 1);
  assert.ok(later && !later.first && later.progress > 0.4 && later.progress < 0.6);
  assert.equal(tr.next('k', at(1000), 2 * ARRIVAL_MIN_INTERVAL_MS), undefined, 'mesmo tempo estimado: espera o refresh');
  assert.ok(tr.next('k', at(1000), ARRIVAL_MIN_INTERVAL_MS + ARRIVAL_REFRESH_MS + 2), 'refresh periódico');
  assert.deepEqual(tr.next('k', at(30), ARRIVAL_MIN_INTERVAL_MS + ARRIVAL_REFRESH_MS + 3), { progress: 1, first: false }, 'chegada sai na hora');
  assert.equal(tr.next('k', at(20), 10 * ARRIVAL_REFRESH_MS), undefined, 'chegada não repete');
  tr.forget('k');
  assert.equal(tr.next('k', at(900), 11 * ARRIVAL_REFRESH_MS)?.first, true);
});

/** Ana convida, Bia aceita; Bia tem o app no iPhone (avisos nativos ligados). */
async function matched() {
  const w = makeWorld();
  w.push.nativeEnabled = true;
  const { ana, bia, caio } = await w.signUpMany('ana', 'bia', 'caio');
  await w.core.follows.follow(ana!, bia!);
  await w.core.follows.follow(bia!, ana!);
  await w.core.flash.turnOn(ana!, { hours: 2 });
  await w.core.flash.turnOn(bia!, { hours: 2 });
  const invite = await w.core.flash.invite(ana!, bia!);
  await w.core.flash.respond(bia!, invite.id, 'accept');
  await w.pushSubscriptions.upsert({ userId: bia!, endpoint: 'apns:' + 'ab'.repeat(32), p256dh: '', auth: '', createdAt: w.clock.now() });
  await w.pushSubscriptions.upsert({ userId: bia!, endpoint: 'https://push.example/bia', p256dh: 'x', auth: 'y', createdAt: w.clock.now() });
  await w.core.flushNotifications();
  w.push.sent.length = 0;
  return { w, ana: ana!, bia: bia!, caio: caio!, inviteId: invite.id };
}

const liveSent = (w: ReturnType<typeof makeWorld>) => w.push.sent.filter((s) => s.message.live);

test('chegada: sem liberar, a posição não vira aviso; liberando, Bia acompanha no celular', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(bia, inviteId, HERE);
  await w.core.flash.shareLocation(ana, inviteId, north(1500));
  await w.core.flushNotifications();
  assert.equal(liveSent(w).length, 0, 'sem consentimento nada sai');

  assert.deepEqual(await w.core.flash.setArrival(ana, inviteId, true), { share: true });
  await w.core.flushNotifications();
  const first = liveSent(w);
  assert.equal(first.length, 1, 'só no app do celular (não no navegador)');
  assert.ok(first[0]!.subscription.endpoint.startsWith('apns:'));
  assert.equal(first[0]!.message.title, 'ana está a caminho');
  assert.match(first[0]!.message.body, /^Chega em ~\d+ min · 1,5 km até você$/);
  assert.equal(first[0]!.message.live?.state, 'moving');
  assert.equal(first[0]!.message.live?.quiet, false, 'a primeira avisa');
  assert.equal(first[0]!.message.tag, `arrival:${inviteId}:${ana}`);

  const match = await w.core.flash.getMatch(bia, inviteId);
  assert.equal(match.themArrival, true);
  assert.equal(match.meArrival, false);

  w.clock.tick(10_000);
  await w.core.flash.shareLocation(ana, inviteId, north(1400));
  await w.core.flushNotifications();
  assert.equal(liveSent(w).length, 1, 'segura atualização seguida');

  w.clock.tick(ARRIVAL_MIN_INTERVAL_MS);
  await w.core.flash.shareLocation(ana, inviteId, north(700));
  await w.core.flushNotifications();
  const update = liveSent(w)[1]!.message;
  assert.equal(update.live?.quiet, true, 'as seguintes trocam o aviso em silêncio');
  assert.ok((update.live?.progress ?? 0) > 0.4);

  await w.core.flash.shareLocation(ana, inviteId, north(30));
  await w.core.flushNotifications();
  const arrived = liveSent(w)[2]!.message;
  assert.equal(arrived.title, 'ana chegou');
  assert.equal(arrived.live?.state, 'arrived');
  assert.equal(arrived.live?.quiet, false);
});

test('chegada: vai até o lugar escolhido; encerrar ou parar troca o aviso por "stopped"', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(bia, inviteId, HERE);
  await w.core.flash.shareLocation(ana, inviteId, north(900));
  await w.core.flash.chooseDestination(bia, inviteId, { name: 'Bar do Zé', ...north(100) });
  await w.core.flash.setArrival(ana, inviteId, true);
  await w.core.flushNotifications();
  assert.match(liveSent(w)[0]!.message.body, /até Bar do Zé$/);

  await w.core.flash.setArrival(ana, inviteId, false);
  await w.core.flushNotifications();
  assert.equal(liveSent(w)[1]!.message.live?.state, 'stopped');
  assert.equal((await w.core.flash.getMatch(bia, inviteId)).themArrival, false);

  await w.core.flash.setArrival(ana, inviteId, true);
  await w.core.flash.end(bia, inviteId);
  await w.core.flushNotifications();
  const last = liveSent(w).at(-1)!.message;
  assert.equal(last.live?.state, 'stopped');
  assert.equal(last.body, 'O encontro foi encerrado');
});

test('chegada: tirar ou trocar o lugar troca o aviso na hora, em silêncio, com a barra do zero', async () => {
  const { w, ana, bia, inviteId } = await matched();
  await w.core.flash.shareLocation(bia, inviteId, HERE);
  await w.core.flash.shareLocation(ana, inviteId, north(900));
  await w.core.flash.chooseDestination(bia, inviteId, { name: 'Bar do Zé', ...north(100) });
  await w.core.flash.setArrival(ana, inviteId, true);
  await w.core.flushNotifications();
  assert.equal(liveSent(w).length, 1);

  w.clock.tick(5_000);
  await w.core.flash.clearDestination(bia, inviteId);
  await w.core.flushNotifications();
  const cleared = liveSent(w)[1]!.message;
  assert.match(cleared.body, /até você$/, 'sem lugar, vai até onde a Bia está');
  assert.equal(cleared.live?.quiet, true);
  assert.equal(cleared.live?.progress, 0);

  w.clock.tick(5_000);
  await w.core.flash.chooseDestination(ana, inviteId, { name: 'Café', ...north(400) });
  await w.core.flushNotifications();
  const changed = liveSent(w)[2]!.message;
  assert.match(changed.body, /até Café$/);
  assert.equal(changed.live?.quiet, true);
});

test('chegada: exige posição exata, só quem está no encontro, e "aproximada" desliga', async () => {
  const { w, ana, caio, inviteId } = await matched();
  await rejectsWith(w.core.flash.setArrival(ana, inviteId, 'sim'), 'VALIDATION');
  await rejectsWith(w.core.flash.setArrival(caio, inviteId, true), 'NOT_FOUND');
  await w.core.flash.setArrival(ana, inviteId, true);
  await w.core.flash.setPrecision(ana, inviteId, true);
  assert.equal((await w.core.flash.getMatch(ana, inviteId)).meArrival, false, 'aproximada desliga a chegada');
  await rejectsWith(w.core.flash.setArrival(ana, inviteId, true), 'VALIDATION');
});
