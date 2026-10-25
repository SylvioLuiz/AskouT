import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeWorld } from './testing/world.ts';

async function friends(w: ReturnType<typeof makeWorld>, ...names: string[]) {
  const ids = await w.signUpMany(...names);
  const all = Object.values(ids);
  for (const a of all) for (const b of all) if (a !== b) await w.core.follows.follow(a, b);
  await w.core.flushNotifications();
  for (const id of all) await w.core.notifications.markRead(id); // os avisos de "começou a seguir" não interessam a estes testes
  return ids as Record<string, string>;
}

describe('avisos', () => {
  it('avisos identificam a pessoa pelo @usuário, nunca pelo nome real', async () => {
    const w = makeWorld();
    const { ana, bia } = await friends(w, 'ana', 'bia');
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    const item = (await w.core.notifications.list(bia!)).items[0]!;
    await w.core.profiles.updateOwn(ana!, { displayName: 'Ana Maria Souza' });
    await w.core.conversations.send(ana!, id, { body: 'oi de novo' });
    await w.core.flushNotifications();
    const titles = (await w.core.notifications.list(bia!)).items.filter((n) => n.type === 'MESSAGE').map((n) => n.title);
    assert.ok(titles.length > 0 && titles.every((t) => t === 'ana'), titles.join(','));
    assert.equal(item.title, 'ana');
  });

  it('latestUnreadAt: o aviso não lido mais recente; nulo sem não lidos', async () => {
    const w = makeWorld();
    const { ana, bia } = await friends(w, 'ana', 'bia');
    assert.equal(await w.core.notifications.latestUnreadAt(bia!), null);
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    const list = await w.core.notifications.list(bia!);
    assert.equal(await w.core.notifications.latestUnreadAt(bia!), list.items[0]!.createdAt);
    await w.core.notifications.markRead(bia!);
    assert.equal(await w.core.notifications.latestUnreadAt(bia!), null);
  });

  it('mensagem avisa quem recebe, sem o texto, e junta avisos enquanto não leu', async () => {
    const w = makeWorld();
    const { ana, bia } = await friends(w, 'ana', 'bia');
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'segredo 123' });
    await w.core.conversations.send(ana!, id, { body: 'outra' });
    await w.core.flushNotifications();
    const list = await w.core.notifications.list(bia!);
    assert.equal(list.unread, 1, 'um aviso só por conversa enquanto não lido');
    assert.equal(list.items[0]!.type, 'MESSAGE');
    assert.ok(!list.items[0]!.body.includes('segredo'), 'o texto da mensagem não vai no aviso');
    assert.equal(list.items[0]!.url, `/conversas/${id}`);
    assert.equal((await w.core.notifications.list(ana!)).unread, 0, 'quem escreveu não é avisado');
    await w.core.notifications.markRead(bia!, list.items[0]!.id);
    await w.core.conversations.send(ana!, id, { body: 'de novo' });
    assert.equal((await w.core.notifications.list(bia!)).unread, 1, 'depois de lido, volta a avisar');
  });

  it('push: envia para os aparelhos inscritos e apaga inscrição vencida', async () => {
    const w = makeWorld();
    const { ana, bia } = await friends(w, 'ana', 'bia');
    const keys = { p256dh: 'BPubKey_-123', auth: 'AuthKey_-1' };
    await w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/a', keys });
    await w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/b', keys });
    w.push.results.set('https://push.example/b', 'GONE');
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    assert.deepEqual(w.push.sent.map((s) => s.subscription.endpoint).sort(), ['https://push.example/a', 'https://push.example/b']);
    assert.equal(w.push.sent[0]!.message.url, `/conversas/${id}`);
    assert.deepEqual((await w.pushSubscriptions.listForUser(bia!)).map((s) => s.endpoint), ['https://push.example/a'], 'inscrição vencida é apagada');
  });

  it('sem chaves de push o aviso dentro do app continua e a inscrição é recusada', async () => {
    const w = makeWorld();
    w.push.publicKey = null;
    const { ana, bia } = await friends(w, 'ana', 'bia');
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/a', keys: { p256dh: 'a', auth: 'b' } }), { code: 'CONFLICT' });
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    assert.equal((await w.core.notifications.list(bia!)).unread, 1);
    assert.equal(w.push.sent.length, 0);
    assert.deepEqual(w.core.notifications.pushKey(), { publicKey: null, native: false });
  });

  it('aparelho do app (iPhone): inscreve com o token da Apple, só quando o envio nativo está ligado', async () => {
    const w = makeWorld();
    const { ana, bia } = await friends(w, 'ana', 'bia');
    const token = 'ab12'.repeat(16);
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: `apns:${token}`, keys: undefined }), { code: 'CONFLICT' }, 'sem chave da Apple no servidor');
    w.push.nativeEnabled = true;
    assert.deepEqual(w.core.notifications.pushKey(), { publicKey: 'chave-publica-de-teste', native: true });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'apns:xyz', keys: undefined }), { code: 'VALIDATION' });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: `apns:${token}0`.replace(/0$/, 'z'), keys: undefined }), { code: 'VALIDATION' });
    await w.core.notifications.subscribe(bia!, { endpoint: `apns:${token}`, keys: undefined });
    assert.deepEqual((await w.pushSubscriptions.listForUser(bia!)).map((s) => s.endpoint), [`apns:${token}`]);
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    assert.deepEqual(w.push.sent.map((s) => s.subscription.endpoint), [`apns:${token}`]);
    await w.core.notifications.unsubscribe(bia!, `apns:${token}`);
    assert.equal((await w.pushSubscriptions.listForUser(bia!)).length, 0);
  });

  it('aparelho Android: inscreve com o token do FCM (`fcm:`) e recusa token com formato errado', async () => {
    const w = makeWorld();
    const { bia } = await friends(w, 'ana', 'bia');
    w.push.nativeEnabled = true;
    const token = `${'f'.repeat(22)}:APA91b${'x'.repeat(80)}`;
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'fcm:curto', keys: undefined }), { code: 'VALIDATION' });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: `fcm:${token}/../x`, keys: undefined }), { code: 'VALIDATION' });
    await w.core.notifications.subscribe(bia!, { endpoint: `fcm:${token}`, keys: undefined });
    const [saved] = await w.pushSubscriptions.listForUser(bia!);
    assert.equal(saved?.endpoint, `fcm:${token}`);
    assert.equal(saved?.p256dh, 'fcm');
  });

  it('só o envio nativo ligado (sem chave do navegador) ainda manda o push ao app', async () => {
    const w = makeWorld();
    w.push.publicKey = null;
    w.push.nativeEnabled = true;
    const { ana, bia } = await friends(w, 'ana', 'bia');
    const token = 'cd34'.repeat(16);
    await w.core.notifications.subscribe(bia!, { endpoint: `apns:${token}`, keys: undefined });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/a', keys: { p256dh: 'a', auth: 'b' } }), { code: 'CONFLICT' }, 'o navegador continua precisando da chave VAPID');
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    assert.equal(w.push.sent.length, 1);
  });

  it('validação da inscrição, limite por pessoa e cancelamento', async () => {
    const w = makeWorld();
    const { bia, ana } = await friends(w, 'ana', 'bia');
    const keys = { p256dh: 'BPubKey_-123', auth: 'AuthKey_-1' };
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'http://inseguro', keys }), { code: 'VALIDATION' });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'https://x/y', keys: { p256dh: 'a b', auth: 'x' } }), { code: 'VALIDATION' });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'https://x/y', keys: undefined }), { code: 'VALIDATION' });
    for (let i = 0; i < 10; i++) await w.core.notifications.subscribe(bia!, { endpoint: `https://push.example/${i}`, keys });
    await assert.rejects(w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/novo', keys }), { code: 'CONFLICT' });
    await w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/3', keys });
    await w.core.notifications.unsubscribe(ana!, 'https://push.example/3');
    assert.equal((await w.pushSubscriptions.listForUser(bia!)).length, 10, 'outra pessoa não cancela a inscrição');
    await w.core.notifications.unsubscribe(bia!, 'https://push.example/3');
    assert.equal((await w.pushSubscriptions.listForUser(bia!)).length, 9);
  });

  it('encontro, grupo, seguir privado e Flash geram avisos', async () => {
    const w = makeWorld();
    const { ana, bia, caio } = await friends(w, 'ana', 'bia', 'caio');
    const types = async (id: string) => (await w.core.notifications.list(id)).items.map((n) => n.type);
    const H = 3_600_000;
    await w.places.createVenue({ id: 'v1', name: 'Parque', address: null, category: 'park', lat: -23.58, lng: -46.65, isSample: true });
    await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: true });

    const meetup = await w.core.meetups.create(ana!, { eventId: 'e1', guestIds: [bia!, caio!] });
    assert.ok((await types(bia!)).includes('MEETUP_INVITE'));
    assert.ok((await types(caio!)).includes('MEETUP_INVITE'));
    assert.equal((await w.core.notifications.list(bia!)).items.find((n) => n.type === 'MEETUP_INVITE')!.body, 'Samba');
    await w.core.meetups.respond(bia!, meetup.id, 'accept');
    assert.ok((await types(ana!)).includes('MEETUP_ACCEPTED'));
    await w.core.meetups.cancel(ana!, meetup.id);
    assert.ok((await types(bia!)).includes('MEETUP_CANCELLED'));
    assert.ok((await types(caio!)).includes('MEETUP_CANCELLED'));

    const second = await w.core.meetups.create(ana!, { eventId: 'e1', guestIds: [bia!, caio!] });
    await w.core.meetups.respond(bia!, second.id, 'accept');
    await w.core.meetups.respond(caio!, second.id, 'accept');
    await w.core.conversations.removeMember(ana!, second.conversationId, caio!);
    assert.ok((await types(caio!)).includes('GROUP_REMOVED'));

    await w.core.profiles.setPrivacy(ana!, true);
    const dani = (await w.signUp('dani')).user.id;
    await w.core.follows.follow(dani, ana!);
    assert.ok((await types(ana!)).includes('FOLLOW_REQUEST'));
    await w.core.follows.approve(ana!, dani);
    assert.ok((await types(dani)).includes('FOLLOW_ACCEPTED'));

    await w.core.flash.turnOn(ana!, { hours: 2 });
    await w.core.flash.turnOn(bia!, { hours: 2 });
    const invite = await w.core.flash.invite(ana!, bia!);
    assert.ok((await types(bia!)).includes('FLASH_INVITE'));
    await w.core.flash.respond(bia!, invite.id, 'accept');
    assert.ok((await types(ana!)).includes('FLASH_INVITE'));
  });

  it('bloqueio dentro do grupo: quem bloqueou não é avisado das mensagens do bloqueado', async () => {
    const w = makeWorld();
    const { ana, bia, caio } = await friends(w, 'ana', 'bia', 'caio');
    const H = 3_600_000;
    await w.places.createVenue({ id: 'v1', name: 'Parque', address: null, category: 'park', lat: -23.58, lng: -46.65, isSample: true });
    await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Samba', description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: true });
    const m = await w.core.meetups.create(ana!, { eventId: 'e1', guestIds: [bia!, caio!] });
    await w.core.meetups.respond(bia!, m.id, 'accept');
    await w.core.meetups.respond(caio!, m.id, 'accept');
    await w.core.blocks.block(bia!, caio!);
    await w.core.notifications.markRead(bia!);
    await w.core.conversations.send(caio!, m.conversationId, { body: 'oi' });
    assert.equal((await w.core.notifications.list(bia!)).unread, 0);
    assert.equal((await w.core.notifications.list(ana!)).items.some((n) => n.type === 'MESSAGE'), true);
  });
});

describe('silenciar avisos', () => {
  it('cada tipo cai no seu grupo: conversas, eventos, ou só em "todas"', async () => {
    const { isMuted, muteGroup } = await import('./notification-service.ts');
    assert.deepEqual(['MESSAGE', 'GROUP_REMOVED', 'MEETUP_INVITE', 'MEETUP_ACCEPTED', 'MEETUP_CANCELLED', 'POST_LIKE', 'FOLLOW_NEW'].map((t) => muteGroup(t as never)), ['chats', 'chats', 'events', 'events', 'events', null, null]);
    assert.equal(isMuted({ all: false, chats: true, events: false }, 'MESSAGE'), true);
    assert.equal(isMuted({ all: false, chats: true, events: false }, 'MEETUP_INVITE'), false);
    assert.equal(isMuted({ all: false, chats: false, events: true }, 'MEETUP_INVITE'), true);
    assert.equal(isMuted({ all: false, chats: true, events: true }, 'POST_LIKE'), false, 'curtida só cala com "todas"');
    assert.equal(isMuted({ all: true, chats: false, events: false }, 'POST_LIKE'), true);
  });

  it('padrão tudo ligado; muda só o que vier; valor que não é true/false é recusado', async () => {
    const w = makeWorld();
    const { ana } = await friends(w, 'ana', 'bia');
    assert.deepEqual(await w.core.notifications.muteSettings(ana!), { all: false, chats: false, events: false });
    assert.deepEqual(await w.core.notifications.setMuteSettings(ana!, { chats: true }), { all: false, chats: true, events: false });
    assert.deepEqual(await w.core.notifications.setMuteSettings(ana!, { events: true }), { all: false, chats: true, events: true });
    assert.deepEqual(await w.core.notifications.muteSettings(ana!), { all: false, chats: true, events: true });
    await assert.rejects(w.core.notifications.setMuteSettings(ana!, { all: 'sim' }), (e: { code?: string }) => e.code === 'VALIDATION');
  });

  it('silenciado não manda push mas continua no sino: conversas calam só mensagens; "todas" cala tudo; desligar volta', async () => {
    const w = makeWorld();
    const { ana, bia } = await friends(w, 'ana', 'bia');
    await w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/bia', keys: { p256dh: 'abc', auth: 'def' } });
    const { id } = await w.core.conversations.open(ana!, bia!);
    const count = async (type: string) => (await w.core.notifications.list(bia!)).items.filter((n) => n.type === type).length;
    const pushes = () => w.push.sent.length;
    await w.core.notifications.setMuteSettings(bia!, { chats: true });
    const before = pushes();
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    assert.equal(await count('MESSAGE'), 1, 'a mensagem continua no sino');
    assert.equal(pushes(), before, 'mas o push foi silenciado');
    const post = await w.core.posts.create(bia!, { images: [`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`] });
    await w.core.posts.like(ana!, post.id);
    await w.core.flushNotifications();
    assert.equal(await count('POST_LIKE'), 1);
    assert.equal(pushes(), before + 1, 'só conversas silenciadas: o push da curtida sai');
    await w.core.notifications.setMuteSettings(bia!, { all: true });
    const other = await w.core.posts.create(bia!, { images: [`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]).toString('base64')}`] });
    await w.core.posts.like(ana!, other.id);
    await w.core.flushNotifications();
    assert.equal(await count('POST_LIKE'), 2, 'todas silenciadas: chega no sino');
    assert.equal(pushes(), before + 1, 'e nenhum push novo');
    await w.core.notifications.markRead(bia!);
    await w.core.notifications.setMuteSettings(bia!, { all: false, chats: false });
    await w.core.conversations.send(ana!, id, { body: 'voltei' });
    await w.core.flushNotifications();
    assert.equal(pushes(), before + 2, 'desligou o silêncio: o push volta');
  });
});
