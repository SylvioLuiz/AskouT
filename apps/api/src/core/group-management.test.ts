import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGroupImage } from './conversation-service.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const H = 3_600_000;
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64')}`;

/** ana cria um grupo com bia e caio já dentro; dani e eva são amigas de ana de fora. */
async function group() {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'dani', 'eva');
  const ana = u['ana']!;
  for (const n of ['bia', 'caio', 'dani', 'eva']) {
    await w.core.follows.follow(ana, u[n]!);
    await w.core.follows.follow(u[n]!, ana);
  }
  await w.places.createVenue({ id: 'v1', name: 'Parque', address: null, category: 'park', lat: -23.58, lng: -46.65, isSample: true });
  await w.places.createEvent({ id: 'e1', venueId: 'v1', title: 'Piquenique', description: null, kind: 'OTHER', isFree: true, imageUrl: null, tags: [], startsAt: new Date(w.clock.now().getTime() + 2 * H), endsAt: new Date(w.clock.now().getTime() + 5 * H), isSample: true });
  const meetup = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [u['bia']!, u['caio']!], name: 'Turma' });
  await w.core.meetups.respond(u['bia']!, meetup.id, 'accept');
  await w.core.meetups.respond(u['caio']!, meetup.id, 'accept');
  return { w, u, ana, bia: u['bia']!, caio: u['caio']!, dani: u['dani']!, eva: u['eva']!, meetup, cid: meetup.conversationId };
}

test('bloqueio no grupo: os dois deixam de ver as mensagens um do outro', async () => {
  const { w, ana, bia, caio, cid } = await group();
  await w.core.conversations.send(bia, cid, { body: 'da bia' });
  await w.core.conversations.send(caio, cid, { body: 'do caio' });
  await w.core.conversations.send(ana, cid, { body: 'da ana' });
  const bodies = async (id: string) => (await w.core.conversations.messages(id, cid)).messages.filter((m) => m.kind === 'TEXT').map((m) => m.body);
  assert.deepEqual(await bodies(caio), ['da bia', 'do caio', 'da ana']);
  await w.core.blocks.block(bia, caio);
  assert.deepEqual(await bodies(bia), ['da bia', 'da ana'], 'quem bloqueou não vê o bloqueado');
  assert.deepEqual(await bodies(caio), ['do caio', 'da ana'], 'o bloqueado também não vê quem bloqueou');
  assert.deepEqual(await bodies(ana), ['da bia', 'do caio', 'da ana']);
  const details = await w.core.conversations.group(bia, cid);
  assert.deepEqual(details.members.map((m) => m.profile.username).sort(), ['ana', 'bia']);
  const item = (await w.core.conversations.list(bia)).find((c) => c.id === cid)!;
  assert.equal(item.memberCount, 2);
  await w.core.conversations.send(caio, cid, { body: 'oculta' });
  assert.equal((await w.core.conversations.list(bia)).find((c) => c.id === cid)!.lastMessage?.body !== 'oculta', true, 'a última mensagem não vem de quem está bloqueado');
  const before = (await w.core.conversations.list(bia)).find((c) => c.id === cid)!.unread;
  await w.core.conversations.send(caio, cid, { body: 'mais uma oculta' });
  assert.equal((await w.core.conversations.list(bia)).find((c) => c.id === cid)!.unread, before, 'não lidas ignoram bloqueados');
  await w.core.blocks.unblock(bia, caio);
  assert.ok((await bodies(bia)).includes('do caio'), 'desbloquear traz de volta');
});

test('sair do grupo: some do grupo e dos encontros; dono passa para o mais antigo', async () => {
  const { w, ana, bia, caio, cid, meetup } = await group();
  await w.core.conversations.leave(bia, cid);
  await rejectsWith(w.core.conversations.messages(bia, cid), 'NOT_FOUND');
  const g = await w.core.conversations.group(ana, cid);
  assert.deepEqual(g.members.map((m) => m.profile.username), ['ana', 'caio']);
  assert.equal((await w.core.meetups.get(ana, meetup.id)).declinedCount, 1);
  const chat = await w.core.conversations.messages(ana, cid);
  assert.ok(chat.messages.some((m) => m.kind === 'SYSTEM' && m.body === 'bia saiu do grupo'));
  await w.core.conversations.leave(ana, cid);
  const after = await w.core.conversations.group(caio, cid);
  assert.equal(after.members.find((m) => m.role === 'OWNER')?.profile.username, 'caio');
  assert.equal((await w.core.conversations.messages(caio, cid)).isOwner, true);
  await rejectsWith(w.core.conversations.leave(ana, cid), 'NOT_FOUND');
});

test('remover: só o dono; não remove a si; pode ser convidado de novo', async () => {
  const { w, ana, bia, caio, cid, meetup } = await group();
  await rejectsWith(w.core.conversations.removeMember(bia, cid, caio), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.removeMember(ana, cid, ana), 'VALIDATION');
  await rejectsWith(w.core.conversations.removeMember(ana, cid, 'ninguem'), 'NOT_FOUND');
  await w.core.conversations.removeMember(ana, cid, caio);
  await rejectsWith(w.core.conversations.messages(caio, cid), 'NOT_FOUND');
  assert.ok((await w.core.conversations.messages(ana, cid)).messages.some((m) => m.kind === 'SYSTEM' && m.body.includes('foi removido(a) por ana')));
  await rejectsWith(w.core.meetups.respond(caio, meetup.id, 'accept'), 'CONFLICT');
  await w.core.meetups.invite(ana, meetup.id, [caio]);
  assert.equal((await w.core.meetups.get(caio, meetup.id)).myStatus, 'INVITED');
  await w.core.meetups.respond(caio, meetup.id, 'accept');
  assert.equal((await w.core.conversations.messages(caio, cid)).type, 'GROUP');
});

test('renomear e foto: só o dono; foto é validada', async () => {
  const { w, ana, bia, cid } = await group();
  await rejectsWith(w.core.conversations.renameGroup(bia, cid, 'Outro'), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.renameGroup(ana, cid, '   '), 'VALIDATION');
  await rejectsWith(w.core.conversations.renameGroup(ana, cid, 'x'.repeat(61)), 'VALIDATION');
  assert.deepEqual(await w.core.conversations.renameGroup(ana, cid, '  Galera  '), { name: 'Galera' });
  assert.equal((await w.core.conversations.messages(bia, cid)).name, 'Galera');
  await rejectsWith(w.core.conversations.setGroupPhoto(bia, cid, JPEG), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.setGroupPhoto(ana, cid, 'data:image/jpeg;base64,AAAA'), 'VALIDATION');
  await rejectsWith(w.core.conversations.setGroupPhoto(ana, cid, 'https://x/y.jpg'), 'VALIDATION');
  await rejectsWith(w.core.conversations.setGroupPhoto(ana, cid, 'data:image/svg+xml;base64,PHN2Zz4='), 'VALIDATION');
  await rejectsWith(w.core.conversations.setGroupPhoto(ana, cid, 'ausente'), 'VALIDATION');
  await w.core.conversations.setGroupPhoto(ana, cid, JPEG);
  assert.equal((await w.core.conversations.group(bia, cid)).imageUrl, JPEG);
  assert.equal((await w.core.conversations.list(bia)).find((c) => c.id === cid)!.imageUrl, JPEG);
  await w.core.conversations.setGroupPhoto(ana, cid, null);
  assert.equal((await w.core.conversations.group(bia, cid)).imageUrl, null);
  assert.throws(() => parseGroupImage(`data:image/jpeg;base64,${Buffer.alloc(41 * 1024, 0xff).toString('base64')}`));
});

test('convidar depois: só quem vai, só amigos, sem duplicar, só em grupo', async () => {
  const { w, u, ana, bia, dani, eva, meetup } = await group();
  const stranger = (await w.signUpMany('fabi'))['fabi']!;
  await w.core.follows.follow(bia, dani);
  await w.core.follows.follow(dani, bia);
  await rejectsWith(w.core.meetups.invite(dani, meetup.id, [eva]), 'NOT_FOUND');
  await rejectsWith(w.core.meetups.invite(bia, meetup.id, []), 'VALIDATION');
  await rejectsWith(w.core.meetups.invite(bia, meetup.id, [stranger]), 'FORBIDDEN');
  const view = await w.core.meetups.invite(bia, meetup.id, [dani, dani]);
  assert.equal(view.invitedCount, 1);
  const again = await w.core.meetups.invite(ana, meetup.id, [dani]);
  assert.equal(again.invitedCount, 1, 'não duplica');
  assert.equal((await w.core.conversations.list(dani)).filter((c) => c.lastMessage?.kind === 'MEETUP').length, 1, 'dani recebeu só 1 cartão na 1 a 1 com bia');
  await rejectsWith(w.core.meetups.invite(dani, meetup.id, [eva]), 'FORBIDDEN');
  await w.core.blocks.block(ana, eva);
  await rejectsWith(w.core.meetups.invite(ana, meetup.id, [eva]), 'NOT_FOUND');
  // Encontro de duas pessoas não vira grupo.
  const duo = await w.core.meetups.create(ana, { eventId: 'e1', guestIds: [u['bia']!] });
  await rejectsWith(w.core.meetups.invite(ana, duo.id, [dani]), 'VALIDATION');
});

test('editar e cancelar o encontro: só quem organiza', async () => {
  const { w, ana, bia, dani, meetup, cid } = await group();
  assert.equal((await w.core.meetups.get(ana, meetup.id)).canManage, true);
  assert.equal((await w.core.meetups.get(bia, meetup.id)).canManage, false);
  await rejectsWith(w.core.meetups.rename(bia, meetup.id, 'Novo'), 'FORBIDDEN');
  await rejectsWith(w.core.meetups.rename(ana, meetup.id, ' '), 'VALIDATION');
  const renamed = await w.core.meetups.rename(ana, meetup.id, 'Piquenique de domingo');
  assert.equal(renamed.title, 'Piquenique de domingo');
  await w.core.meetups.invite(ana, meetup.id, [dani]);
  await rejectsWith(w.core.meetups.cancel(bia, meetup.id), 'FORBIDDEN');
  const cancelled = await w.core.meetups.cancel(ana, meetup.id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.canManage, false);
  await rejectsWith(w.core.meetups.respond(dani, meetup.id, 'accept'), 'CONFLICT');
  await rejectsWith(w.core.meetups.rename(ana, meetup.id, 'x'), 'CONFLICT');
  await rejectsWith(w.core.meetups.invite(ana, meetup.id, [dani]), 'CONFLICT');
  const system = (await w.core.conversations.messages(bia, cid)).messages.filter((m) => m.kind === 'SYSTEM').map((m) => m.body);
  assert.ok(system.some((b) => b.includes('mudou o nome do encontro')) && system.some((b) => b.includes('cancelou o encontro')));
});

test('novo grupo direto: só amigos, 2 a 15 pessoas, dono é quem criou', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio', 'dani');
  const ana = u['ana']!;
  for (const n of ['bia', 'caio']) {
    await w.core.follows.follow(ana, u[n]!);
    await w.core.follows.follow(u[n]!, ana);
  }
  const { id } = await w.core.conversations.createGroup(ana, { name: ' Turma ', memberIds: [u['bia']!, u['caio']!] });
  const g = await w.core.conversations.group(ana, id);
  assert.equal(g.name, 'Turma');
  assert.equal(g.ownerId, ana);
  assert.deepEqual(g.members.map((m) => m.profile.username).sort(), ['ana', 'bia', 'caio']);
  assert.ok((await w.core.conversations.list(u['bia']!)).some((c) => c.id === id));
  await rejectsWith(w.core.conversations.createGroup(ana, { name: 'X', memberIds: [u['bia']!] }), 'VALIDATION');
  await rejectsWith(w.core.conversations.createGroup(ana, { name: '', memberIds: [u['bia']!, u['caio']!] }), 'VALIDATION');
  await rejectsWith(w.core.conversations.createGroup(ana, { name: 'X', memberIds: [u['bia']!, u['dani']!] }), 'FORBIDDEN');
  await rejectsWith(w.core.conversations.createGroup(ana, { name: 'X', memberIds: [u['bia']!, ana] }), 'VALIDATION');
});

test('administradores: dono e admin editam e removem; só o dono tira admin ou remove admin', async () => {
  const { w, ana, bia, caio, dani, cid } = await group();
  const conv = w.core.conversations;
  const roles = async (id: string) => Object.fromEntries((await conv.group(id, cid)).members.map((m) => [m.profile.username, m.role]));
  assert.deepEqual(await roles(ana), { ana: 'OWNER', bia: 'MEMBER', caio: 'MEMBER' });
  assert.equal((await conv.group(ana, cid)).canManage, true);
  assert.equal((await conv.group(bia, cid)).canManage, false);
  await rejectsWith(conv.renameGroup(bia, cid, 'Novo'), 'FORBIDDEN');
  await rejectsWith(conv.setAdmin(bia, cid, caio, true), 'FORBIDDEN');

  assert.deepEqual(await conv.setAdmin(ana, cid, bia, true), { role: 'ADMIN' });
  assert.deepEqual(await roles(ana), { ana: 'OWNER', bia: 'ADMIN', caio: 'MEMBER' });
  assert.equal((await conv.group(bia, cid)).canManage, true);
  await conv.renameGroup(bia, cid, 'Turma nova');
  await conv.setGroupPhoto(bia, cid, null);
  const sys = (await conv.messages(ana, cid)).messages.filter((m) => m.kind === 'SYSTEM').map((m) => m.body);
  assert.ok(sys.some((b) => b.includes('bia') || b.toLowerCase().includes('administrador')));

  await rejectsWith(conv.setAdmin(ana, cid, ana, true), 'VALIDATION');
  await rejectsWith(conv.setAdmin(ana, cid, dani, true), 'NOT_FOUND');
  await rejectsWith(conv.setAdmin(ana, cid, caio, 'sim' as unknown as boolean), 'VALIDATION');
  // um admin promove membros, mas não tira admin
  await conv.setAdmin(bia, cid, caio, true);
  await rejectsWith(conv.setAdmin(bia, cid, caio, false), 'FORBIDDEN');
  // admin remove membro comum, não admin nem o dono
  await rejectsWith(conv.removeMember(bia, cid, caio), 'FORBIDDEN');
  await rejectsWith(conv.removeMember(bia, cid, ana), 'FORBIDDEN');
  await conv.setAdmin(ana, cid, caio, false);
  await conv.removeMember(bia, cid, caio);
  assert.deepEqual(await roles(ana), { ana: 'OWNER', bia: 'ADMIN' });
  // o dono sai: o mais antigo vira dono e deixa de ser admin
  await conv.leave(ana, cid);
  assert.deepEqual(await roles(bia), { bia: 'OWNER' });
});

test('detalhe do grupo diz quem eu já sigo', async () => {
  const { w, ana, bia, caio, cid } = await group();
  await w.core.follows.unfollow(ana, caio);
  const follow = async () => Object.fromEntries((await w.core.conversations.group(ana, cid)).members.map((m) => [m.profile.username, m.follow]));
  assert.deepEqual(await follow(), { ana: 'NONE', bia: 'FOLLOWING', caio: 'NONE' });
  void bia;
});

test('adicionar pessoas ao grupo: só dono/administrador, só amigos de quem adiciona, sem repetir, com aviso', async () => {
  const { w, u, ana, bia, caio, dani, eva, cid } = await group();
  const conv = w.core.conversations;
  await w.core.follows.follow(bia, dani);
  await w.core.follows.follow(dani, bia);
  await rejectsWith(conv.addMembers(ana, cid, []), 'VALIDATION');
  await rejectsWith(conv.addMembers(bia, cid, [dani]), 'FORBIDDEN');
  await conv.setAdmin(ana, cid, bia, true);
  await rejectsWith(conv.addMembers(bia, cid, [eva]), 'FORBIDDEN');
  assert.deepEqual(await conv.addMembers(bia, cid, [dani, bia, caio]), { added: 1 });
  assert.deepEqual(await conv.addMembers(ana, cid, [dani]), { added: 0 });
  const names = (await conv.group(ana, cid)).members.map((m) => m.profile.username).sort();
  assert.deepEqual(names, ['ana', 'bia', 'caio', 'dani']);
  const sys = (await conv.messages(ana, cid)).messages.filter((m) => m.kind === 'SYSTEM').map((m) => m.body);
  assert.ok(sys.some((b) => b.includes('adicionou')));
  await w.core.blocks.block(ana, u['eva']!);
  await rejectsWith(conv.addMembers(ana, cid, [eva]), 'NOT_FOUND');
  await rejectsWith(conv.addMembers(eva, cid, [dani]), 'NOT_FOUND');
});

test('apagar grupo: só quem criou apaga, para todos; os outros recebem aviso e o grupo some', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia', 'caio');
  const ana = u['ana']!;
  for (const n of ['bia', 'caio']) {
    await w.core.follows.follow(ana, u[n]!);
    await w.core.follows.follow(u[n]!, ana);
  }
  const { id } = await w.core.conversations.createGroup(ana, { name: 'Turma', memberIds: [u['bia']!, u['caio']!] });
  await w.core.conversations.send(u['bia']!, id, { body: 'oi' });
  await rejectsWith(w.core.conversations.deleteGroup(u['bia']!, id), 'FORBIDDEN');
  assert.ok((await w.core.conversations.list(u['bia']!)).some((c) => c.id === id), 'quem não criou não apaga');
  assert.deepEqual(await w.core.conversations.deleteGroup(ana, id), { deleted: true });
  for (const n of ['ana', 'bia', 'caio']) {
    assert.equal((await w.core.conversations.list(u[n]!)).some((c) => c.id === id), false, n);
    await rejectsWith(w.core.conversations.messages(u[n]!, id), 'NOT_FOUND');
  }
  const notes = await w.core.notifications.list(u['bia']!);
  assert.ok(notes.items.some((n) => n.type === 'GROUP_REMOVED' && n.body.includes('apagado')));
  await rejectsWith(w.core.conversations.deleteGroup(ana, id), 'NOT_FOUND');
});

test('apagar grupo não vale para conversa 1 a 1', async () => {
  const w = makeWorld();
  const u = await w.signUpMany('ana', 'bia');
  await w.core.follows.follow(u['ana']!, u['bia']!);
  await w.core.follows.follow(u['bia']!, u['ana']!);
  const direct = await w.core.conversations.open(u['ana']!, u['bia']!);
  await rejectsWith(w.core.conversations.deleteGroup(u['ana']!, direct.id), 'NOT_FOUND');
});
