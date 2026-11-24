import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { androidChannelFor, apnsSoundFor, soundGroup, soundOrDefault } from './notification-sounds.ts';
import { makeWorld } from './testing/world.ts';

async function friends(w: ReturnType<typeof makeWorld>, ...names: string[]) {
  const ids = await w.signUpMany(...names);
  const all = Object.values(ids);
  for (const a of all) for (const b of all) if (a !== b) await w.core.follows.follow(a, b);
  await w.core.flushNotifications();
  w.push.sent.length = 0;
  return ids as Record<string, string>;
}

const IPHONE = `apns:${'ab12'.repeat(16)}`;
const ANDROID = `fcm:${'f'.repeat(30)}:${'A'.repeat(60)}`;

describe('sons dos avisos', () => {
  it('cada tipo de aviso cai no grupo certo', () => {
    assert.equal(soundGroup('MESSAGE'), 'chats');
    assert.equal(soundGroup('GROUP_REMOVED'), 'chats');
    assert.equal(soundGroup('MEETUP_INVITE'), 'invites');
    assert.equal(soundGroup('FLASH_INVITE'), 'invites');
    assert.equal(soundGroup('POST_LIKE'), 'other');
    assert.equal(soundGroup('EVENT_REMINDER'), 'other');
  });

  it('som em cada sistema: canal no Android, arquivo no iPhone', () => {
    assert.equal(androidChannelFor('padrao'), 'notificacoes', 'o canal de sempre');
    assert.equal(androidChannelFor('sino'), 'som_sino');
    assert.equal(androidChannelFor('silencioso'), 'som_silencioso');
    assert.equal(apnsSoundFor('padrao'), 'default');
    assert.equal(apnsSoundFor('pop'), 'pop.wav');
    assert.equal(apnsSoundFor('silencioso'), undefined);
    assert.equal(soundOrDefault('xilofone'), 'padrao', 'valor estranho no banco volta ao padrão');
  });

  it('salva por grupo, muda só o que vier e recusa som ou grupo desconhecido', async () => {
    const w = makeWorld();
    const { ana } = await friends(w, 'ana');
    assert.deepEqual(await w.core.notifications.soundSettings(ana!), { chats: 'padrao', invites: 'padrao', arrival: 'padrao', other: 'padrao' });
    assert.deepEqual(await w.core.notifications.setSoundSettings(ana!, { chats: 'pop' }), { chats: 'pop', invites: 'padrao', arrival: 'padrao', other: 'padrao' });
    await w.core.notifications.setSoundSettings(ana!, { arrival: 'sino', other: 'silencioso' });
    assert.deepEqual(await w.core.notifications.soundSettings(ana!), { chats: 'pop', invites: 'padrao', arrival: 'sino', other: 'silencioso' });
    await assert.rejects(w.core.notifications.setSoundSettings(ana!, { chats: 'xilofone' }), { code: 'VALIDATION' });
    await assert.rejects(w.core.notifications.setSoundSettings(ana!, { likes: 'pop' }), { code: 'VALIDATION' });
    await assert.rejects(w.core.notifications.setSoundSettings(ana!, null), { code: 'VALIDATION' });
  });

  it('o push leva o som do grupo, só para aparelhos com os sons (app antigo: som padrão)', async () => {
    const w = makeWorld();
    w.push.nativeEnabled = true;
    const { ana, bia } = await friends(w, 'ana', 'bia');
    await w.core.notifications.subscribe(bia!, { endpoint: IPHONE, keys: undefined, sounds: true });
    await w.core.notifications.subscribe(bia!, { endpoint: ANDROID, keys: undefined });
    await w.core.notifications.subscribe(bia!, { endpoint: 'https://push.example/a', keys: { p256dh: 'BPubKey_-123', auth: 'AuthKey_-1' } });
    await w.core.notifications.setSoundSettings(bia!, { chats: 'pop', other: 'silencioso' });
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    const byEndpoint = (e: string) => w.push.sent.find((s) => s.subscription.endpoint === e)!.message;
    assert.equal(byEndpoint(IPHONE).sound, 'pop');
    assert.equal(byEndpoint(ANDROID).sound, undefined, 'app antigo no Android: sem o canal do som, vai o padrão');
    assert.equal(byEndpoint('https://push.example/a').sound, 'pop', 'navegador: o próprio envio ignora o que não sabe tocar');
    w.push.sent.length = 0;
    const post = await w.core.posts.create(bia!, { placeName: 'Bar do Zé', images: [`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')}`] });
    await w.core.posts.like(ana!, post.id);
    await w.core.flushNotifications();
    assert.equal(byEndpoint(IPHONE).sound, 'silencioso', 'curtida é de "outros avisos"');
  });

  it('com o som padrão, a mensagem do push sai como sempre (sem o campo)', async () => {
    const w = makeWorld();
    w.push.nativeEnabled = true;
    const { ana, bia } = await friends(w, 'ana', 'bia');
    await w.core.notifications.subscribe(bia!, { endpoint: IPHONE, keys: undefined, sounds: true });
    const { id } = await w.core.conversations.open(ana!, bia!);
    await w.core.conversations.send(ana!, id, { body: 'oi' });
    await w.core.flushNotifications();
    assert.equal('sound' in w.push.sent[0]!.message, false);
  });
});
