import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedEventId, linkedVenueId } from './conversation-service.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10, 1)]).toString('base64')}`;
const ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

test('link de evento no texto: acha o id; outros links e mensagens que não são texto ficam de fora', () => {
  const text = (body: string) => ({ kind: 'TEXT' as const, body, eventId: null, postEventId: null });
  assert.equal(linkedEventId(text(`Bora? https://askout.app/eventos/${ID}`)), ID);
  assert.equal(linkedEventId(text(`olha /eventos/${ID.toUpperCase()}?x=1 e /eventos/outro`)), ID);
  assert.equal(linkedEventId(text('https://askout.app/bares/123')), undefined);
  assert.equal(linkedEventId({ ...text(`/eventos/${ID}`), kind: 'EVENT' as const }), undefined);
  assert.equal(linkedEventId({ ...text(`/eventos/${ID}`), eventId: 'e1' }), undefined, 'já tem cartão próprio');
});

test('colar o link de um evento na conversa mostra o cartão com foto, título e link', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia');
  const [ana, bia] = [u['ana']!, u['bia']!];
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  const at = (h: number) => new Date(w.clock.now().getTime() + h * H).toISOString();
  const event = await w.core.posts.create(ana, { images: [JPEG], placeName: 'Praça', event: { title: 'Corrida no parque', startsAt: at(5) } });
  const dm = await w.core.conversations.open(ana, bia);

  const sent = await w.core.conversations.send(ana, dm.id, { body: `Vem comigo? https://askout.app/eventos/${event.id}` });
  assert.equal(sent.kind, 'TEXT');
  assert.equal(sent.event?.id, event.id, 'já volta com o cartão');
  assert.equal(sent.event?.title, 'Corrida no parque');

  await w.core.conversations.send(ana, dm.id, { body: 'sem link nenhum' });
  await w.core.conversations.send(ana, dm.id, { body: 'https://askout.app/eventos/00000000-0000-4000-8000-000000000000' });
  const chat = await w.core.conversations.messages(bia, dm.id);
  const [withLink, plain, missing] = chat.messages.slice(-3);
  assert.equal(withLink?.event?.title, 'Corrida no parque', 'quem recebe também vê o cartão');
  assert.equal(withLink?.body, `Vem comigo? https://askout.app/eventos/${event.id}`, 'o texto continua');
  assert.equal(plain?.event, null);
  assert.equal(missing?.event, null, 'evento que não existe: fica só o texto');
});

test('link da página de um local no texto: acha o id; link de evento tem prioridade', () => {
  const text = (body: string) => ({ kind: 'TEXT' as const, body, eventId: null, postEventId: null });
  assert.equal(linkedVenueId(text(`Olha esse bar: https://askout.com.br/bares/${ID}`)), ID);
  assert.equal(linkedVenueId(text(`/locais/${ID.toUpperCase()}/agenda`)), ID);
  assert.equal(linkedVenueId(text('https://askout.com.br/bares/123')), undefined, 'id que não é de local');
  assert.equal(linkedVenueId(text(`https://askout.com.br/bares/${ID}/eventos/${ID}`)), undefined, 'é link de evento');
  assert.equal(linkedVenueId({ ...text(`/bares/${ID}`), kind: 'EVENT' as const }), undefined);
});

test('compartilhar a página de um local na conversa mostra o cartão do local, que abre no app', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia');
  const [ana, bia] = [u['ana']!, u['bia']!];
  await w.core.follows.follow(ana, bia);
  await w.core.follows.follow(bia, ana);
  await w.places.createVenue({ id: ID, name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.5, lng: -46.6, isSample: false });
  const dm = await w.core.conversations.open(ana, bia);

  const sent = await w.core.conversations.send(ana, dm.id, { body: `Bar do Zé no AskouT: https://askout.com.br/bares/${ID}` });
  assert.equal(sent.venue?.id, ID, 'já volta com o cartão');
  assert.equal(sent.venue?.name, 'Bar do Zé');
  assert.equal(sent.event, null);

  await w.core.conversations.send(ana, dm.id, { body: 'https://askout.com.br/bares/00000000-0000-4000-8000-000000000000' });
  const [withLink, missing] = (await w.core.conversations.messages(bia, dm.id)).messages.slice(-2);
  assert.equal(withLink?.venue?.address, 'Rua A, 1', 'quem recebe também vê o cartão');
  assert.equal(missing?.venue, null, 'local que não existe: fica só o texto');
});
