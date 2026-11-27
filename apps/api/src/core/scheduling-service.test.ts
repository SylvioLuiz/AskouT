import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

async function setup(policy: 'UNANIMITY' | 'MAJORITY' | 'MANUAL' = 'MAJORITY') {
  const w = makeWorld();
  const users = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  const ana = users['ana']!;
  const bia = users['bia']!;
  const caio = users['caio']!;
  const dani = users['dani']!;
  for (const id of [bia, caio, dani]) {
    await w.core.follows.follow(ana, id);
    await w.core.follows.follow(id, ana);
  }
  const group = await w.core.conversations.createGroup(ana, { name: 'Rolê', memberIds: [bia, caio, dani] });
  const poll = await w.core.scheduling.create(ana, group.id, { title: 'Churrasco', rangeStart: '2026-10-20', rangeEnd: '2026-10-26', durationMinutes: 240, confirmationPolicy: policy });
  return { w, ana, bia, caio, dani, group, poll };
}

test('criar: valida intervalo, passado e permissão', async () => {
  const { w, ana, group, bia } = await setup();
  const base = { title: 'X', rangeStart: '2026-10-20', rangeEnd: '2026-10-22' };
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeStart: '2026-10-01' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeEnd: '2026-10-19' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeEnd: '2027-03-01' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, title: '' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, confirmationPolicy: 'X' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, timezone: 'Marte/Olimpo' }), 'VALIDATION');
  const w2 = makeWorld();
  const u = await w2.signUpMany('xavi', 'yara');
  await rejectsWith(w2.core.scheduling.create(u['xavi']!, group.id, base), 'NOT_FOUND');
  void bia;
});

test('votar: um voto por dia, edição, limpar, fora do intervalo e permissões', async () => {
  const { w, ana, bia, poll } = await setup();
  assert.equal(poll.days.length, 7);
  let v = await w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-23', '2026-10-24'] });
  assert.equal(v.myVotes['2026-10-23'], 'YES');
  v = await w.core.scheduling.vote(bia, poll.id, { status: 'NO', dates: ['2026-10-23'] });
  assert.equal(v.myVotes['2026-10-23'], 'NO');
  assert.equal(Object.keys(v.myVotes).length, 2);
  v = await w.core.scheduling.vote(bia, poll.id, { status: 'CLEAR', dates: ['2026-10-24'] });
  assert.equal(v.myVotes['2026-10-24'], undefined);
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-27'] }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'XX', dates: ['2026-10-23'] }), 'VALIDATION');
  const out = (await w.signUp('zeca')).user.id;
  await rejectsWith(w.core.scheduling.get(out, poll.id), 'NOT_FOUND');
  await rejectsWith(w.core.scheduling.vote(out, poll.id, { status: 'YES', dates: ['2026-10-23'] }), 'NOT_FOUND');
  // sem resposta não conta como "não posso"
  const day = (await w.core.scheduling.get(ana, poll.id)).days.find((d) => d.date === '2026-10-25')!;
  assert.equal(day.no, 0);
  assert.equal(day.unanswered, 4);
});

test('mapa de calor e ranking mudam quando os votos mudam; concluir não muda votos', async () => {
  const { w, ana, bia, caio, dani, poll } = await setup();
  assert.equal((await w.core.scheduling.get(ana, poll.id)).enoughData, false);
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.vote(u, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  await w.core.scheduling.vote(ana, poll.id, { status: 'MAYBE', dates: ['2026-10-25'] });
  let v = await w.core.scheduling.get(ana, poll.id);
  assert.equal(v.ranking[0]!.date, '2026-10-24');
  assert.equal(v.ranking[0]!.compatibility, 100);
  assert.equal(v.ranking[0]!.coverage, 100);
  assert.equal(v.enoughData, true);
  await w.core.scheduling.vote(bia, poll.id, { status: 'NO', dates: ['2026-10-24'] });
  v = await w.core.scheduling.get(ana, poll.id);
  assert.equal(v.days.find((d) => d.date === '2026-10-24')!.no, 1);
  v = await w.core.scheduling.finish(bia, poll.id, true);
  assert.equal(v.iFinished, true);
  assert.equal(v.myVotes['2026-10-24'], 'NO');
  v = await w.core.scheduling.finish(bia, poll.id, false);
  assert.equal(v.iFinished, false);
});

test('só o organizador propõe; maioria fecha e cria o encontro no calendário', async () => {
  const { w, ana, bia, caio, dani, poll, group } = await setup('MAJORITY');
  await rejectsWith(w.core.scheduling.propose(bia, poll.id, '2026-10-24'), 'FORBIDDEN');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, '2026-11-24'), 'VALIDATION');
  let v = await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  assert.equal(v.status, 'CONFIRMING');
  assert.equal(v.proposal?.startsAt, '2026-10-24T22:00:00.000Z');
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-24'] }), 'CONFLICT');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, '2026-10-25'), 'CONFLICT');
  v = await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  assert.equal(v.status, 'CONFIRMING');
  v = await w.core.scheduling.respond(caio, poll.id, 'CONFIRMED');
  assert.equal(v.status, 'FINALIZED');
  assert.ok(v.final?.meetupId);
  assert.equal((await w.core.scheduling.get(dani, poll.id)).final?.date, '2026-10-24');
  const chat = await w.core.conversations.messages(dani, group.id);
  assert.ok(chat.messages.some((m) => m.kind === 'MEETUP'));
  await rejectsWith(w.core.scheduling.respond(dani, poll.id, 'CONFIRMED'), 'CONFLICT');
  assert.equal((await w.core.scheduling.listForConversation(ana, group.id)).items[0]!.finalDate, '2026-10-24');
});

test('unanimidade: uma recusa derruba a data e a votação reabre; histórico fica', async () => {
  const { w, ana, bia, poll } = await setup('UNANIMITY');
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  const v = await w.core.scheduling.respond(bia, poll.id, 'DECLINED');
  assert.equal(v.status, 'VOTING');
  assert.equal(v.proposal, null);
  assert.equal(v.history.length, 1);
  assert.equal(v.history[0]!.status, 'REJECTED');
  const again = await w.core.scheduling.propose(ana, poll.id, '2026-10-25');
  assert.equal(again.status, 'CONFIRMING');
});

test('decisão manual: só o organizador fecha; retirar proposta e cancelar', async () => {
  const { w, ana, bia, caio, poll } = await setup('MANUAL');
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  let v = await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  v = await w.core.scheduling.respond(caio, poll.id, 'ADJUST');
  assert.equal(v.status, 'CONFIRMING');
  await rejectsWith(w.core.scheduling.finalizeManual(bia, poll.id), 'FORBIDDEN');
  v = await w.core.scheduling.finalizeManual(ana, poll.id);
  assert.equal(v.status, 'FINALIZED');

  const s = await setup('MANUAL');
  await s.w.core.scheduling.propose(s.ana, s.poll.id, '2026-10-24');
  assert.equal((await s.w.core.scheduling.withdraw(s.ana, s.poll.id)).status, 'VOTING');
  await rejectsWith(s.w.core.scheduling.cancel(s.bia, s.poll.id), 'FORBIDDEN');
  assert.equal((await s.w.core.scheduling.cancel(s.ana, s.poll.id)).status, 'CANCELLED');
  await rejectsWith(s.w.core.scheduling.vote(s.bia, s.poll.id, { status: 'YES', dates: ['2026-10-24'] }), 'CONFLICT');
});

test('prazo de votação encerra os votos; eventos do mesmo grupo são independentes', async () => {
  const { w, ana, bia, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const b = await w.core.scheduling.create(ana, group.id, { title: 'Cinema', rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  await w.core.scheduling.vote(bia, b.id, { status: 'YES', dates: ['2026-10-21'] });
  w.clock.tick(2 * 3_600_000);
  await rejectsWith(w.core.scheduling.vote(bia, b.id, { status: 'YES', dates: ['2026-10-22'] }), 'CONFLICT');
  assert.equal((await w.core.scheduling.get(bia, b.id)).votingOpen, false);
  const list = await w.core.scheduling.listForConversation(ana, group.id);
  assert.equal(list.items.length, 2);
});

test('resumo da conversa: progresso, melhor data até agora e proposta', async () => {
  const { w, ana, bia, caio, dani, group, poll } = await setup('MANUAL');
  let s = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(s.participantCount, 4);
  assert.equal(s.finishedCount, 0);
  assert.equal(s.best, null);
  assert.equal(s.needsMyVote, true);
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.vote(u, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  await w.core.scheduling.finish(bia, poll.id, true);
  s = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(s.finishedCount, 1);
  assert.equal(s.best?.date, '2026-10-24');
  assert.equal(s.best?.compatibility, 100);
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  s = (await w.core.scheduling.listForConversation(bia, group.id)).items[0]!;
  assert.equal(s.proposedDate, '2026-10-24');
  assert.equal(s.needsMyConfirmation, true);
  assert.equal(s.best, null);
});

test('encerrar votos: só o organizador, só com todos concluídos; trava votos; prazo fecha sozinho', async () => {
  const { w, ana, bia, caio, dani, poll } = await setup('MANUAL');
  assert.equal(poll.canClose, false);
  await rejectsWith(w.core.scheduling.closeVoting(ana, poll.id), 'CONFLICT');
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.finish(u, poll.id, true);
  assert.equal((await w.core.scheduling.get(ana, poll.id)).canClose, true);
  assert.equal((await w.core.scheduling.get(bia, poll.id)).canClose, false);
  await rejectsWith(w.core.scheduling.closeVoting(bia, poll.id), 'FORBIDDEN');
  const closed = await w.core.scheduling.closeVoting(ana, poll.id);
  assert.equal(closed.votingClosed, true);
  assert.equal(closed.votingOpen, false);
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'NO', dates: ['2026-10-24'] }), 'CONFLICT');
  await rejectsWith(w.core.scheduling.closeVoting(ana, poll.id), 'CONFLICT');
  // com votos fechados ainda dá para propor, e uma proposta recusada reabre os votos
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  const back = await w.core.scheduling.withdraw(ana, poll.id);
  assert.equal(back.votingOpen, true);
});

test('prazo vencido encerra sozinho e some da lista "falta votar"', async () => {
  const { w, ana, bia, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const p = await w.core.scheduling.create(ana, group.id, { title: 'Cinema', rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  assert.equal((await w.core.scheduling.get(bia, p.id)).votingClosed, false);
  w.clock.tick(2 * 3_600_000);
  const v = await w.core.scheduling.get(bia, p.id);
  assert.equal(v.votingClosed, true);
  const item = (await w.core.scheduling.listForConversation(bia, group.id)).items.find((i) => i.id === p.id)!;
  assert.equal(item.needsMyVote, false);
  const proposed = await w.core.scheduling.propose(ana, p.id, '2026-10-22');
  assert.equal(proposed.status, 'CONFIRMING');
});

test('resumo traz votantes e fim da data definida', async () => {
  const { w, ana, bia, caio, group, poll } = await setup('MANUAL');
  await w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  let s = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(s.votedCount, 1);
  assert.equal(s.finalEndsAt, null);
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  await w.core.scheduling.finalizeManual(ana, poll.id);
  s = (await w.core.scheduling.listForConversation(caio, group.id)).items[0]!;
  assert.equal(s.finalDate, '2026-10-24');
  assert.equal(s.finalEndsAt, '2026-10-25T02:00:00.000Z');
});

const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;

test('evento criado a partir da votação: confirmados já vão, nome sincroniza, uma vez só', async () => {
  const { w, ana, bia, caio, dani, poll, group } = await setup('MAJORITY');
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG], event: { title: 'X', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id }), 'CONFLICT');
  await w.core.scheduling.propose(ana, poll.id, '2026-10-24');
  await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  await w.core.scheduling.respond(caio, poll.id, 'CONFIRMED');
  await rejectsWith(w.core.posts.create(bia, { images: [JPEG], event: { title: 'X', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id }), 'NOT_FOUND');
  const post = await w.core.posts.create(ana, { images: [JPEG], event: { title: 'Churras na laje', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id });
  const ref = { source: 'USER' as const, id: post.id };
  assert.equal(await w.eventRoom.isGoing(ref, bia), true);
  assert.equal(await w.eventRoom.isGoing(ref, caio), true);
  assert.equal(await w.eventRoom.isGoing(ref, dani), false);
  const eventIds = async (username: string) => (await w.core.posts.listByUsername(bia, username, { kind: 'event' })).items.map((p) => p.id);
  assert.deepEqual(await eventIds('ana'), [post.id], 'o evento continua na aba Eventos de quem organizou');
  const [item] = (await w.core.scheduling.listForConversation(ana, group.id)).items;
  assert.equal(item!.title, 'Churras na laje');
  assert.equal(item!.event?.id, post.id);
  const linked = await w.meetups.find(item!.meetupId!);
  assert.equal(linked?.eventPostId, post.id, 'o encontro guarda o ID do evento');
  assert.equal((await w.core.meetups.get(ana, item!.meetupId!)).eventRef, post.id);
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG], event: { title: 'Outro', startsAt: '2026-10-24T22:00:00.000Z' }, datePollId: poll.id }), 'CONFLICT');
  await w.core.posts.update(ana, post.id, { event: { title: 'Churras renomeado', startsAt: '2026-10-24T22:00:00.000Z' } });
  const after = (await w.core.scheduling.listForConversation(ana, group.id)).items[0]!;
  assert.equal(after.title, 'Churras renomeado');
  assert.equal((await w.core.meetups.get(ana, after.meetupId!)).title, 'Churras renomeado');
});

test('prazo acabou: avisa todos uma única vez (chat + notificação) e o organizador escolhe a data', async () => {
  const { w, ana, bia, caio, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const p = await w.core.scheduling.create(ana, group.id, { title: 'Cinema', rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  assert.equal(await w.core.scheduling.notifyDeadlines(), 0);
  w.clock.tick(2 * 3_600_000);
  assert.equal(await w.core.scheduling.notifyDeadlines(), 1);
  assert.equal(await w.core.scheduling.notifyDeadlines(), 0);
  const titles = async (id: string) => (await w.core.notifications.list(id)).items.filter((n) => n.url === `/planejar/${p.id}` && /encerrou|encerrada/i.test(n.title)).map((n) => n.title);
  assert.deepEqual(await titles(bia), ['Votação encerrada']);
  assert.deepEqual(await titles(caio), ['Votação encerrada']);
  assert.deepEqual(await titles(ana), ['Sua votação encerrou']);
  const chat = await w.core.conversations.messages(bia, group.id);
  assert.ok(chat.messages.some((m) => m.kind === 'SYSTEM' && m.body.includes('prazo da votação "Cinema" acabou')));
});

test('prazo: votação já encerrada à mão, proposta ou cancelada não avisa', async () => {
  const { w, ana, bia, caio, dani, group } = await setup();
  const deadline = new Date(w.clock.now().getTime() + 3_600_000).toISOString();
  const mk = (title: string) => w.core.scheduling.create(ana, group.id, { title, rangeStart: '2026-10-21', rangeEnd: '2026-10-23', votingDeadline: deadline });
  const closed = await mk('A');
  for (const u of [ana, bia, caio, dani]) await w.core.scheduling.finish(u, closed.id, true);
  await w.core.scheduling.closeVoting(ana, closed.id);
  const cancelled = await mk('B');
  await w.core.scheduling.cancel(ana, cancelled.id);
  w.clock.tick(2 * 3_600_000);
  assert.equal(await w.core.scheduling.notifyDeadlines(), 0);
});

test('confirmar a melhor data: só quando todos concluíram; cria o encontro com quem pode e quem talvez, todos confirmados', async () => {
  const { w, ana, bia, caio, dani, poll, group } = await setup('MAJORITY');
  await rejectsWith(w.core.scheduling.confirmBest(ana, poll.id), 'CONFLICT');
  await w.core.scheduling.vote(ana, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  await w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  await w.core.scheduling.vote(caio, poll.id, { status: 'MAYBE', dates: ['2026-10-24'] });
  await w.core.scheduling.vote(dani, poll.id, { status: 'NO', dates: ['2026-10-24'] });
  for (const id of [ana, bia, caio]) await w.core.scheduling.finish(id, poll.id, true);
  // ainda falta a Dani concluir
  await rejectsWith(w.core.scheduling.confirmBest(ana, poll.id), 'CONFLICT');
  await w.core.scheduling.finish(dani, poll.id, true);
  await rejectsWith(w.core.scheduling.confirmBest(bia, poll.id), 'FORBIDDEN');
  await rejectsWith(w.core.scheduling.confirmBest(ana, poll.id, '2026-11-24'), 'VALIDATION');
  const v = await w.core.scheduling.confirmBest(ana, poll.id, '2026-10-24');
  assert.equal(v.status, 'FINALIZED');
  assert.equal(v.final?.date, '2026-10-24');
  assert.ok(v.final?.meetupId);
  const mine = await w.core.meetups.listMine(ana);
  const meetup = mine.find((m) => m.id === v.final!.meetupId)!;
  // Ana (organiza), Bia (posso) e Caio (talvez) confirmados; Dani (não posso) fica de fora.
  assert.equal(meetup.confirmedCount, 3);
  assert.equal(meetup.invitedCount, 0);
  assert.equal(meetup.declinedCount, 0);
  assert.equal(meetup.myStatus, 'ORGANIZER');
  const daniView = await w.core.meetups.listMine(dani);
  assert.equal(daniView.some((m) => m.id === meetup.id), false);
  const caioView = (await w.core.meetups.listMine(caio)).find((m) => m.id === meetup.id)!;
  assert.equal(caioView.myStatus, 'CONFIRMED');
  const chat = await w.core.conversations.messages(dani, group.id);
  assert.ok(chat.messages.some((m) => m.kind === 'MEETUP'));
  await rejectsWith(w.core.scheduling.confirmBest(ana, poll.id), 'CONFLICT');
});

test('confirmar a melhor data: sem informar o dia, usa o 1º do ranking; vale depois de encerrar os votos', async () => {
  const { w, ana, bia, caio, dani, poll } = await setup('MAJORITY');
  for (const id of [ana, bia, caio]) await w.core.scheduling.vote(id, poll.id, { status: 'YES', dates: ['2026-10-25'] });
  for (const id of [ana, bia, caio, dani]) await w.core.scheduling.finish(id, poll.id, true);
  const before = await w.core.scheduling.get(ana, poll.id);
  assert.equal(before.ranking[0]!.date, '2026-10-25');
  const v = await w.core.scheduling.confirmBest(ana, poll.id);
  assert.equal(v.final?.date, '2026-10-25');
});

test('editar: só quem organiza muda nome, datas e regra; dias novos reabrem quem concluiu', async () => {
  const { w, ana, bia, caio, group, poll } = await setup('MAJORITY');
  await w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-26'] });
  await w.core.scheduling.finish(bia, poll.id, true);
  await rejectsWith(w.core.scheduling.update(bia, poll.id, { title: 'Outro' }), 'FORBIDDEN');
  await rejectsWith(w.core.scheduling.update(ana, poll.id, { title: '' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.update(ana, poll.id, { rangeEnd: '2026-10-10' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.update(ana, poll.id, { confirmationPolicy: 'X' }), 'VALIDATION');

  // nome + regra
  let v = await w.core.scheduling.update(ana, poll.id, { title: 'Feijoada', confirmationPolicy: 'MANUAL' });
  assert.equal(v.title, 'Feijoada');
  assert.equal(v.confirmationPolicy, 'MANUAL');

  // tirar dias: voto de fora some da visão, mas volta se o dia voltar
  v = await w.core.scheduling.update(ana, poll.id, { rangeEnd: '2026-10-24' });
  assert.equal(v.days.length, 5);
  assert.equal((await w.core.scheduling.get(bia, poll.id)).myVotes['2026-10-26'], undefined);

  // dias novos: quem já tinha concluído volta a poder votar
  v = await w.core.scheduling.update(ana, poll.id, { rangeEnd: '2026-10-28' });
  assert.equal(v.days.length, 9);
  assert.equal((await w.core.scheduling.get(bia, poll.id)).myVotes['2026-10-26'], 'YES');
  const chat = await w.core.conversations.messages(caio, group.id);
  assert.ok(chat.messages.some((m) => /mudou/.test(m.body ?? '')));

  // votação cancelada ou encerrada não se edita
  await w.core.scheduling.cancel(ana, poll.id);
  await rejectsWith(w.core.scheduling.update(ana, poll.id, { title: 'Tarde demais' }), 'CONFLICT');
});

test('evento sem data decidida por votação: cria sem data, a votação liga ao evento e, ao fechar, o evento ganha o dia', async () => {
  const { w, ana, bia, caio, dani, group } = await setup('MAJORITY');
  // Sem data só com dateByPoll.
  await rejectsWith(w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Aniversário' } }), 'VALIDATION');
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Aniversário', dateByPoll: true } });
  assert.equal(post.event?.startsAt, null);
  assert.equal(post.event?.endsAt, null);
  const page = await w.core.eventPages.get(ana, post.id);
  assert.equal(page.startsAt, null);
  // Só o dono liga a votação a um evento seu sem data.
  await rejectsWith(w.core.scheduling.create(bia, group.id, { title: 'X', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id }), 'VALIDATION');
  const poll = await w.core.scheduling.create(ana, group.id, { title: 'Aniversário', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id });
  await rejectsWith(w.core.scheduling.create(ana, group.id, { title: 'De novo', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id }), 'CONFLICT');
  for (const id of [ana, bia, caio]) await w.core.scheduling.vote(id, poll.id, { status: 'YES', dates: ['2026-10-21'] });
  for (const id of [ana, bia, caio, dani]) await w.core.scheduling.finish(id, poll.id, true);
  const v = await w.core.scheduling.confirmBest(ana, poll.id, '2026-10-21');
  assert.equal(v.status, 'FINALIZED');
  const after = await w.core.eventPages.get(bia, post.id);
  assert.equal(after.startsAt, v.final?.startsAt);
  assert.equal(after.endsAt, v.final?.endsAt);
  assert.equal(after.going, true, 'quem votou "posso" já vai');
  // Com data, a edição sem data nova mantém a data.
  const edited = await w.core.posts.update(ana, post.id, { event: { title: 'Aniversário da Ana', startsAt: v.final!.startsAt } });
  assert.equal(edited.event?.startsAt, v.final?.startsAt);
});

test('evento sem data: todo convidado vota; no grupo só entra quem aceitou, e quem é convidado depois entra na votação', async () => {
  const { w, ana, bia, caio, dani } = await setup('MAJORITY');
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Aniversário', dateByPoll: true } });
  const base = { title: 'Aniversário', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id };

  // Sem convidados ainda: pede para convidar primeiro.
  await rejectsWith(w.core.scheduling.create(ana, undefined, base), 'VALIDATION');

  // Convidou a bia e o caio (conversas 1 a 1); só a bia aceitou ("Eu vou"). Os dois votam, só a bia está no grupo.
  const withBia = await w.core.conversations.open(ana, bia);
  const withCaio = await w.core.conversations.open(ana, caio);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
  await w.core.conversations.send(ana, withCaio.id, { eventId: post.id });
  await w.core.eventPages.go(bia, post.id);
  const poll = await w.core.scheduling.create(ana, undefined, base);
  assert.notEqual(poll.conversationId, withBia.id);
  assert.deepEqual(poll.participants.map((p) => p.profile.username).sort(), ['ana', 'bia', 'caio']);
  const group = await w.conversations.findById(poll.conversationId);
  assert.equal(group?.type, 'GROUP');
  assert.equal(group?.name, 'Aniversário');
  assert.deepEqual((await w.conversations.participantIds(poll.conversationId))?.sort(), [ana, bia].sort(), 'quem não aceitou não entra no grupo');

  // O caio vota fora do grupo: abre a votação (pela página do evento ou pelo aviso) e vota.
  const forCaio = await w.core.scheduling.vote(caio, poll.id, { dates: ['2026-10-20'], status: 'YES' });
  assert.equal(forCaio.inConversation, false);
  assert.equal(forCaio.eventPostId, post.id);
  assert.equal((await w.core.eventPages.get(caio, post.id)).datePollId, poll.id);
  assert.equal((await w.core.eventPages.get(caio, post.id)).group, null);
  await rejectsWith(w.core.conversations.messages(caio, poll.conversationId), 'NOT_FOUND');
  assert.equal((await w.core.scheduling.get(bia, poll.id)).inConversation, true);

  // Aceitou depois: entra no grupo nessa hora. Desmarcou: sai do grupo, mas segue na votação.
  await w.core.eventPages.go(caio, post.id);
  assert.ok((await w.conversations.participantIds(poll.conversationId))?.includes(caio));
  assert.equal((await w.core.eventPages.get(caio, post.id)).group?.conversationId, poll.conversationId);
  await w.core.eventPages.cancel(caio, post.id);
  assert.equal((await w.conversations.participantIds(poll.conversationId))?.includes(caio), false);
  assert.equal((await w.core.scheduling.get(caio, poll.id)).iFinished, false, 'continua votando');

  // Convidou a dani depois: entra na votação, não no grupo.
  const withDani = await w.core.conversations.open(ana, dani);
  await w.core.conversations.send(ana, withDani.id, { eventId: post.id });
  const after = await w.core.scheduling.get(ana, poll.id);
  assert.deepEqual(after.participants.map((p) => p.profile.username).sort(), ['ana', 'bia', 'caio', 'dani']);
  assert.equal((await w.conversations.participantIds(poll.conversationId))?.includes(dani), false);
  const chat = await w.core.conversations.messages(ana, poll.conversationId);
  assert.ok(chat.messages.some((m) => /convidou mais uma pessoa/.test(m.body ?? '')));

  // Mandar de novo para quem já está não muda nada; quem repassa (não é quem criou) não põe ninguém na votação.
  await w.core.conversations.send(ana, withDani.id, { eventId: post.id });
  assert.equal((await w.core.scheduling.get(ana, poll.id)).participants.length, 4);
});

test('página do evento sem data: o dono vê se já tem votação (para abrir ou editar) e quem participa vê para votar', async () => {
  const { w, ana, bia, caio } = await setup('MAJORITY');
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Churras', dateByPoll: true } });
  assert.equal((await w.core.eventPages.get(ana, post.id)).datePollId, null, 'sem votação: o dono vê o botão de abrir');
  const withBia = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
  const poll = await w.core.scheduling.create(ana, undefined, { title: 'Churras', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id });
  assert.equal((await w.core.eventPages.get(ana, post.id)).datePollId, poll.id);
  assert.equal((await w.core.eventPages.get(bia, post.id)).datePollId, poll.id, 'convidada vota');
  // Cancelada: volta a poder abrir outra, e a nova é a que vale.
  await w.core.scheduling.cancel(ana, poll.id);
  assert.equal((await w.core.eventPages.get(ana, post.id)).datePollId, null);
  w.clock.tick(60_000);
  const again = await w.core.scheduling.create(ana, undefined, { title: 'Churras', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id });
  assert.equal((await w.core.eventPages.get(ana, post.id)).datePollId, again.id);
  void caio;
});

test('evento sem data (em votação): o dono pode postar flash sem "Eu vou"', async () => {
  const { w, ana, bia } = await setup('MAJORITY');
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Churras', dateByPoll: true } });
  assert.equal((await w.core.eventPages.get(ana, post.id)).canStory, true);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(1)]);
  const group = await w.core.eventPages.createStory(ana, post.id, 'image/jpeg', jpg);
  assert.equal(group.items.length, 1);
  void bia;
});

test('grupo do evento: sem foto própria mostra a capa do evento; a foto trocada vale só para o grupo', async () => {
  const { w, ana, bia } = await setup('MAJORITY');
  const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Aniversário', dateByPoll: true } });
  const withBia = await w.core.conversations.open(ana, bia);
  await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
  await w.core.eventPages.go(bia, post.id);
  const poll = await w.core.scheduling.create(ana, undefined, { title: 'Aniversário', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id });
  const cover = `/posts/images/${post.images[0]!.id}`;

  const group = await w.core.conversations.group(ana, poll.conversationId);
  assert.equal(group.imageUrl, cover, 'o grupo mostra a capa do evento');
  assert.equal(group.ownImage, false);
  assert.deepEqual(group.event, { id: post.id, title: 'Aniversário', coverUrl: cover, coverImageId: post.images[0]!.id, canEditCover: true });
  const forBia = await w.core.conversations.group(bia, poll.conversationId);
  assert.equal(forBia.event?.canEditCover, false, 'só quem criou o evento troca a capa');
  assert.equal(forBia.event?.coverImageId, null);
  assert.equal((await w.core.conversations.list(bia)).find((c) => c.id === poll.conversationId)?.imageUrl, cover, 'na lista de conversas também');

  // Foto própria do grupo: a capa do evento não muda.
  const own = JPEG;
  await w.core.conversations.setGroupPhoto(ana, poll.conversationId, own);
  const after = await w.core.conversations.group(ana, poll.conversationId);
  assert.equal(after.imageUrl, own);
  assert.equal(after.ownImage, true);
  assert.equal(after.event?.coverUrl, cover);
  // Tirar a foto do grupo volta a mostrar a capa.
  await w.core.conversations.setGroupPhoto(ana, poll.conversationId, null);
  assert.equal((await w.core.conversations.group(ana, poll.conversationId)).imageUrl, cover);
});

test('grupo do evento: quem é adicionado entra na votação e recebe convite; no privado ganha acesso ao evento', async () => {
  for (const isPrivate of [false, true]) {
    const { w, ana, bia, caio } = await setup('MAJORITY');
    const post = await w.core.posts.create(ana, { images: [JPEG], caption: 'Bora', event: { title: 'Aniversário', dateByPoll: true, private: isPrivate } });
    const withBia = await w.core.conversations.open(ana, bia);
    await w.core.conversations.send(ana, withBia.id, { eventId: post.id });
    const poll = await w.core.scheduling.create(ana, undefined, { title: 'Aniversário', rangeStart: '2026-10-20', rangeEnd: '2026-10-22', eventPostId: post.id });
    if (isPrivate) await rejectsWith(w.core.eventPages.get(caio, post.id), 'NOT_FOUND');

    await w.core.conversations.addMembers(ana, poll.conversationId, [caio]);
    assert.ok((await w.core.scheduling.get(caio, poll.id)).participants.some((p) => p.profile.username === 'caio'), 'entra na votação');
    assert.equal((await w.core.eventPages.get(caio, post.id)).id, post.id, 'vê o evento (o cartão está no grupo)');
    const invite = w.notifications.rows.find((n) => n.userId === caio && n.dedupeKey === `group-event-invite:${post.id}`);
    assert.ok(invite, 'recebe o convite');
    assert.equal(invite.url, `/eventos/${post.id}`);
    assert.match(invite.title, /ana convidou você para Aniversário/);
    assert.match(invite.body, isPrivate ? /faz parte deste evento privado/ : /Eu vou/);
    // O cartão do evento entra no grupo uma vez só.
    const cards = (await w.core.conversations.messages(ana, poll.conversationId)).messages.filter((m) => m.kind === 'EVENT');
    assert.equal(cards.length, 1);
  }
});

async function setupMode(mode: 'BEST_TIME' | 'BEST_DATE_TIME') {
  const base = await setup();
  const { w, ana, group } = base;
  const range = mode === 'BEST_TIME' ? { rangeStart: '2026-10-24', rangeEnd: '2026-10-24' } : { rangeStart: '2026-10-23', rangeEnd: '2026-10-25' };
  const poll = await w.core.scheduling.create(ana, group.id, { title: 'Pizza', ...range, mode, candidateTimes: ['21:00', '19:00', '19:00'], durationMinutes: 120 });
  return { ...base, poll };
}

test('só horário: um dia só, de 2 a 12 horários, sem dias para votar', async () => {
  const { w, ana, group } = await setup();
  const base = { title: 'Pizza', rangeStart: '2026-10-24', rangeEnd: '2026-10-24', mode: 'BEST_TIME', candidateTimes: ['19:00', '21:00'] };
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, rangeEnd: '2026-10-25' }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, candidateTimes: ['19:00'] }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, candidateTimes: ['19:00', '25:00'] }), 'VALIDATION');
  await rejectsWith(w.core.scheduling.create(ana, group.id, { ...base, mode: 'X' }), 'VALIDATION');
  const { w: w2, poll, bia } = await setupMode('BEST_TIME');
  assert.equal(poll.mode, 'BEST_TIME');
  assert.deepEqual(poll.candidateTimes, ['19:00', '21:00']);
  assert.deepEqual(poll.days, []);
  assert.deepEqual(poll.times.map((t) => t.date), ['19:00', '21:00']);
  await rejectsWith(w2.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['2026-10-24'] }), 'VALIDATION');
  await rejectsWith(w2.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['20:00'] }), 'VALIDATION');
  const v = await w2.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['21:00'] });
  assert.equal(v.myVotes['21:00'], 'YES');
});

test('só horário: a proposta usa o dia da votação e o horário escolhido; confirmar o melhor pega o horário mais votado', async () => {
  const { w, ana, bia, caio, dani, poll } = await setupMode('BEST_TIME');
  for (const id of [ana, bia, caio]) await w.core.scheduling.vote(id, poll.id, { status: 'YES', dates: ['21:00'] });
  await w.core.scheduling.vote(dani, poll.id, { status: 'NO', dates: ['21:00'] });
  await w.core.scheduling.vote(dani, poll.id, { status: 'YES', dates: ['19:00'] });
  const view = await w.core.scheduling.get(ana, poll.id);
  assert.equal(view.timeRanking[0]?.date, '21:00');
  assert.equal(view.enoughData, true);
  const summary = (await w.core.scheduling.listMine(ana)).items.find((p) => p.id === poll.id)!;
  assert.deepEqual([summary.best?.date, summary.best?.time], ['2026-10-24', '21:00']);
  for (const id of [ana, bia, caio, dani]) await w.core.scheduling.finish(id, poll.id, true);
  const done = await w.core.scheduling.confirmBest(ana, poll.id);
  assert.equal(done.status, 'FINALIZED');
  assert.equal(done.final?.date, '2026-10-24');
  // 21:00 em São Paulo (UTC-3), duas horas de duração.
  assert.equal(done.final?.startsAt, '2026-10-25T00:00:00.000Z');
  assert.equal(done.final?.endsAt, '2026-10-25T02:00:00.000Z');
  const meetup = (await w.core.meetups.listMine(ana)).find((m) => m.id === done.final!.meetupId)!;
  assert.equal(meetup.confirmedCount, 3);
});

test('só horário: propor um horário (também mandado no lugar do dia) e confirmar', async () => {
  const { w, ana, bia, caio, poll } = await setupMode('BEST_TIME');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, undefined, '20:00'), 'VALIDATION');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, '2026-10-25', '19:00'), 'VALIDATION');
  const v = await w.core.scheduling.propose(ana, poll.id, '19:00');
  assert.equal(v.proposal?.date, '2026-10-24');
  assert.equal(v.proposal?.startsAt, '2026-10-24T22:00:00.000Z');
  await w.core.scheduling.respond(bia, poll.id, 'CONFIRMED');
  const fin = await w.core.scheduling.respond(caio, poll.id, 'CONFIRMED');
  assert.equal(fin.status, 'FINALIZED');
});

test('data e horário: vota dias e horários; vai quem pode no dia e no horário', async () => {
  const { w, ana, bia, caio, dani, poll } = await setupMode('BEST_DATE_TIME');
  assert.equal(poll.days.length, 3);
  assert.equal(poll.times.length, 2);
  for (const id of [ana, bia, caio, dani]) await w.core.scheduling.vote(id, poll.id, { status: 'YES', dates: ['2026-10-24'] });
  for (const id of [ana, bia]) await w.core.scheduling.vote(id, poll.id, { status: 'YES', dates: ['19:00', '21:00'] });
  await w.core.scheduling.vote(caio, poll.id, { status: 'MAYBE', dates: ['21:00'] });
  await w.core.scheduling.vote(dani, poll.id, { status: 'NO', dates: ['21:00'] });
  await w.core.scheduling.vote(dani, poll.id, { status: 'YES', dates: ['19:00'] });
  await w.core.scheduling.vote(caio, poll.id, { status: 'NO', dates: ['19:00'] });
  const view = await w.core.scheduling.get(ana, poll.id);
  assert.equal(view.myVotes['2026-10-24'], 'YES');
  assert.equal(view.myVotes['21:00'], 'YES');
  await rejectsWith(w.core.scheduling.propose(ana, poll.id, '2026-10-24'), 'VALIDATION');
  for (const id of [ana, bia, caio, dani]) await w.core.scheduling.finish(id, poll.id, true);
  const done = await w.core.scheduling.confirmBest(ana, poll.id, '2026-10-24', '21:00');
  assert.equal(done.final?.startsAt, '2026-10-25T00:00:00.000Z');
  const meetup = (await w.core.meetups.listMine(ana)).find((m) => m.id === done.final!.meetupId)!;
  // Ana e Bia (posso nos dois) e Caio (talvez às 21h); Dani não pode às 21h.
  assert.equal(meetup.confirmedCount, 3);
});

test('votação só de data não aceita horário', async () => {
  const { w, bia, poll } = await setup();
  assert.equal(poll.mode, 'BEST_DATE');
  assert.deepEqual(poll.times, []);
  await rejectsWith(w.core.scheduling.vote(bia, poll.id, { status: 'YES', dates: ['19:00'] }), 'VALIDATION');
});
