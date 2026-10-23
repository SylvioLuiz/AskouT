import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaAccountRepository } from './prisma-account.repository.ts';

/**
 * Apagar e exportar conta contra um Postgres de TESTE (ASKOUT_TEST_DATABASE_URL, banco terminado em _test).
 * Monta uma conta cheia (grupo, encontro, mensagens, posts, Flash, local, impulsionamento...) e confere que
 * a exclusão passa pelas chaves estrangeiras sem erro, leva tudo da pessoa e preserva o que é de outras pessoas.
 * Sem a variável, é pulado.
 */
const url = process.env.ASKOUT_TEST_DATABASE_URL;

test('conta no Postgres: exportar e apagar em cascata', { skip: url ? false : 'defina ASKOUT_TEST_DATABASE_URL' }, async () => {
  const dbName = new URL(url!).pathname.replace(/^\//, '');
  assert.ok(dbName.endsWith('_test'), 'só roda em banco _test');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: url! });
  await prisma.$connect();
  try {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "PendingSignup", "Venue" CASCADE');
    const repo = new PrismaAccountRepository(prisma);
    const now = new Date('2026-10-22T12:00:00Z');
    const later = new Date('2026-10-23T12:00:00Z');

    const mk = async (name: string) =>
      (await prisma.user.create({ data: { email: `${name}@teste.com`, passwordHash: 'x', profile: { create: { username: name, displayName: name.toUpperCase() } }, settings: { create: { timeZone: 'America/Sao_Paulo', notifyPrefs: {} } } } })).id;
    const ana = await mk('ana');
    const bia = await mk('bia');
    const cris = await mk('cris');

    // Relações
    await prisma.follow.createMany({ data: [{ followerId: ana, followeeId: bia }, { followerId: bia, followeeId: ana }] });
    await prisma.block.create({ data: { blockerId: ana, blockedId: cris } });
    await prisma.userRegion.create({ data: { userId: ana, lat: -23.5, lng: -46.6, updatedAt: now } });
    await prisma.availabilitySlot.create({ data: { userId: ana, startsAt: now, endsAt: later, state: 'AVAILABLE' } });
    await prisma.externalIdentity.create({ data: { provider: 'GOOGLE', subject: 'sub-ana', userId: ana } });
    await prisma.pendingSignup.create({ data: { email: 'ana@teste.com', username: 'ana', displayName: 'Ana', passwordHash: 'x', codeHash: 'x', expiresAt: later, lastSentAt: now } });

    // Grupo da Ana com a Bia (passa para a Bia) e grupo só da Ana (some)
    const g1 = await prisma.group.create({ data: { ownerId: ana, name: 'Rolê', members: { create: [{ userId: ana, role: 'OWNER' }, { userId: bia, role: 'MEMBER' }] } } });
    const g2 = await prisma.group.create({ data: { ownerId: ana, name: 'Só eu', members: { create: [{ userId: ana, role: 'OWNER' }] } } });

    // Conversa direta Ana-Bia com mensagens das duas, resposta da Bia à Ana e reação
    const conv = await prisma.conversation.create({ data: { type: 'DIRECT', directKey: `${ana}:${bia}`, participants: { create: [{ userId: ana }, { userId: bia }] } } });
    const mAna = await prisma.message.create({ data: { conversationId: conv.id, senderId: ana, kind: 'TEXT', body: 'oi' } });
    const mBia = await prisma.message.create({ data: { conversationId: conv.id, senderId: bia, kind: 'TEXT', body: 'oi, ana', replyToId: mAna.id } });
    await prisma.messageReaction.create({ data: { messageId: mBia.id, userId: ana, emoji: '👍' } });
    // Conversa só da Ana (fica vazia e some)
    const convSolo = await prisma.conversation.create({ data: { type: 'DIRECT', directKey: `${ana}:${ana}`, participants: { create: [{ userId: ana }] } } });
    await prisma.message.create({ data: { conversationId: convSolo.id, senderId: ana, kind: 'TEXT', body: 'sozinha' } });

    // Encontro organizado pela Ana com a Bia participando
    const meeting = await prisma.meeting.create({ data: { organizerId: ana, title: 'Pizza', status: 'PLANNING', conversationId: conv.id, participants: { create: [{ userId: ana, status: 'CONFIRMED' }, { userId: bia, status: 'INVITED' }] } } });
    await prisma.message.create({ data: { conversationId: conv.id, senderId: bia, kind: 'MEETUP', body: 'cartão do encontro', meetupId: meeting.id } });

    // Posts, comentários e curtidas
    const postAna = await prisma.post.create({ data: { authorId: ana, caption: 'post da ana' } });
    const postBia = await prisma.post.create({ data: { authorId: bia, caption: 'post da bia' } });
    await prisma.postComment.create({ data: { postId: postBia.id, authorId: ana, body: 'comentário da ana' } });
    await prisma.postComment.create({ data: { postId: postAna.id, authorId: bia, body: 'comentário da bia' } });
    await prisma.postLike.create({ data: { postId: postBia.id, userId: ana } });

    // Flash e avisos
    await prisma.flashInvite.create({ data: { fromUserId: ana, toUserId: bia, status: 'PENDING', expiresAt: later } });
    await prisma.notification.create({ data: { userId: ana, type: 'X', payload: {} } });
    await prisma.contentDwell.create({ data: { userId: ana, targetType: 'POST', targetId: postBia.id, ms: 1000, source: 'FEED', createdAt: now } });

    // Local administrado pela Ana (continua existindo, sem dono) e impulsionamento encerrado
    const venue = await prisma.venue.create({ data: { name: 'Bar', lat: -23.5, lng: -46.6, ownerId: ana } });
    await prisma.boost.create({ data: { venueId: venue.id, ownerId: ana, channel: 'WEB', target: 'VENUE', days: 1, amountCents: 1000, status: 'PAID', createdAt: now, startsAt: now, endsAt: now } });
    await prisma.venueFollow.create({ data: { userId: ana, venueId: venue.id } });

    // ---- Exportar
    assert.equal(await repo.hasExternalIdentity(ana), true);
    assert.equal(await repo.hasExternalIdentity(bia), false);
    assert.equal(await repo.activeBoostCount(ana, later), 0, 'impulsionamento já encerrado não conta');
    assert.equal(await repo.activeBoostCount(ana, new Date(now.getTime() - 1000)), 1, 'em andamento conta');
    const data = await repo.exportData(ana);
    const text = JSON.stringify(data);
    assert.ok(!text.includes('passwordHash') && !text.includes('"x"'), 'sem segredos');
    assert.equal((data['account'] as { email: string }).email, 'ana@teste.com');
    assert.equal((data['following'] as unknown[]).length, 1);
    assert.equal((data['messagesSent'] as unknown[]).length, 2);
    assert.equal((data['comments'] as unknown[]).length, 1);
    assert.ok(!text.includes('comentário da bia') && !text.includes('oi, ana'), 'conteúdo de outras pessoas fica de fora');
    assert.ok(text.includes('post da ana'));

    // ---- Apagar
    await repo.deleteAccount(ana);

    assert.equal(await prisma.user.count({ where: { id: ana } }), 0);
    assert.equal(await prisma.profile.count({ where: { userId: ana } }), 0);
    assert.equal(await prisma.follow.count(), 0);
    assert.equal(await prisma.block.count(), 0);
    assert.equal(await prisma.userRegion.count(), 0);
    assert.equal(await prisma.pendingSignup.count(), 0);
    assert.equal(await prisma.flashInvite.count(), 0);
    assert.equal(await prisma.notification.count(), 0);
    assert.equal(await prisma.contentDwell.count(), 0);
    assert.equal(await prisma.boost.count(), 0);
    assert.equal(await prisma.venueFollow.count(), 0);
    assert.equal(await prisma.meeting.count(), 0, 'encontro organizado por ela some');
    assert.equal(await prisma.messageReaction.count(), 0);
    // Do que é de outras pessoas, fica o que não era da Ana
    assert.equal(await prisma.user.count({ where: { id: { in: [bia, cris] } } }), 2);
    assert.equal(await prisma.post.count({ where: { id: postBia.id } }), 1);
    assert.equal(await prisma.postComment.count(), 0, 'comentário da Bia no post da Ana some junto com o post; o da Ana, junto com ela');
    assert.equal(await prisma.venue.count({ where: { id: venue.id, ownerId: null } }), 1, 'o local fica, sem dono');
    // Grupos: o da Ana com a Bia passa a ser da Bia; o só dela some
    const g1After = await prisma.group.findUnique({ where: { id: g1.id }, include: { members: true } });
    assert.equal(g1After?.ownerId, bia);
    assert.deepEqual(g1After?.members.map((m) => [m.userId, m.role]), [[bia, 'OWNER']]);
    assert.equal(await prisma.group.count({ where: { id: g2.id } }), 0);
    // Mensagens: as da Ana somem; a da Bia que respondia a ela continua, sem a referência
    const bMsgs = await prisma.message.findMany({ where: { senderId: bia }, orderBy: { createdAt: 'asc' } });
    assert.equal(bMsgs.length, 1, 'a mensagem do cartão do encontro some junto com o encontro');
    assert.equal(bMsgs[0]?.replyToId, null);
    assert.equal(await prisma.conversation.count({ where: { id: convSolo.id } }), 0, 'conversa sem ninguém some');
    assert.equal(await prisma.conversation.count({ where: { id: conv.id } }), 1);

    // Apagar de novo (ou id inválido) não quebra
    await repo.deleteAccount(ana);
    await repo.deleteAccount('nao-e-uuid');
    assert.deepEqual(await repo.exportData('nao-e-uuid'), {});
  } finally {
    await prisma.$disconnect();
  }
});
