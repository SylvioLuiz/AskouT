// Cria pessoas e posts de EXEMPLO para o primeiro acesso não cair num app vazio.
// Tudo é marcado "[TESTE]" e as contas usam e-mail @teste.askout.invalid, que não existe: ninguém consegue entrar nelas.
//
//   npm run seed:demo                       (cria/atualiza as pessoas e posts de exemplo)
//   npm run seed:demo -- --follow sylvio    (e faz @sylvio e as pessoas de exemplo se seguirem: viram amigos,
//                                            com conversas 1 a 1 e dois grupos de exemplo)
//   npm run seed:demo -- --clear            (apaga tudo que veio daqui)
//
// Pode rodar quantas vezes quiser: não duplica. Não roda em produção.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
const DOMAIN = '@teste.askout.invalid';
const TERMS_VERSION = '2026-10-22';
// Hash inválido de propósito: a verificação de senha sempre recusa.
const NO_LOGIN = '!conta-de-exemplo-sem-login';

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(here, '..', '.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('DATABASE_URL não encontrada (variável de ambiente ou apps/api/.env)');
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.env.NODE_ENV === 'production') {
  console.error('Recusado: este script cria dados de exemplo e não roda em produção (NODE_ENV=production).');
  process.exit(1);
}

// PNG de cor única (sem depender de biblioteca de imagem): suficiente para o post ter uma foto.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function solidPng(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PEOPLE = [
  { slug: 'ana', name: 'Ana', bio: 'Perfil de exemplo para testar o AskouT. Não é uma pessoa real.', color: [181, 110, 252] as [number, number, number], posts: ['[TESTE] Happy hour de sexta, quem vem?', '[TESTE] Achei um café novo perto do trabalho.'] },
  { slug: 'bruno', name: 'Bruno', bio: 'Perfil de exemplo para testar o AskouT. Não é uma pessoa real.', color: [250, 114, 201] as [number, number, number], posts: ['[TESTE] Show de rock no sábado.'] },
  { slug: 'carla', name: 'Carla', bio: 'Perfil de exemplo para testar o AskouT. Não é uma pessoa real.', color: [77, 163, 255] as [number, number, number], posts: ['[TESTE] Feira de artesanato no domingo de manhã.', '[TESTE] Cinema de clássicos na quarta.'] },
  { slug: 'diego', name: 'Diego', bio: 'Perfil de exemplo para testar o AskouT. Não é uma pessoa real.', color: [52, 199, 89] as [number, number, number], posts: ['[TESTE] Noite de jogos de tabuleiro.'] },
  ...(
    [
      ['elisa', 'Elisa', [255, 159, 10], ['[TESTE] Piquenique no parque no sábado.']],
      ['felipe', 'Felipe', [94, 92, 230], ['[TESTE] Pedal de domingo cedo, bora?']],
      ['gabi', 'Gabi', [255, 55, 95], ['[TESTE] Karaokê na quinta à noite.', '[TESTE] Brunch novo no centro.']],
      ['heitor', 'Heitor', [48, 176, 199], ['[TESTE] Jogo do time no bar da esquina.']],
      ['isa', 'Isa', [191, 90, 242], ['[TESTE] Exposição de fotografia aberta até domingo.']],
      ['joao', 'João', [100, 210, 255], ['[TESTE] Samba de roda na praça.']],
      ['karina', 'Karina', [255, 214, 10], ['[TESTE] Aula de dança grátis no sábado.']],
      ['lucas', 'Lucas', [172, 142, 104], ['[TESTE] Trilha leve com vista bonita.']],
      ['marina', 'Marina', [255, 105, 180], ['[TESTE] Clube do livro na livraria.']],
      ['nico', 'Nico', [0, 199, 190], ['[TESTE] Festa à fantasia sexta.']],
      ['olivia', 'Olívia', [142, 142, 147], ['[TESTE] Feirinha gastronômica no domingo.']],
      ['pedro', 'Pedro', [52, 120, 246], ['[TESTE] Stand-up comedy na terça.']],
    ] as const
  ).map(([slug, name, color, posts]) => ({ slug, name, bio: 'Perfil de exemplo para testar o AskouT. Não é uma pessoa real.', color: [...color] as [number, number, number], posts: [...posts] })),
];

/** Conversas 1 a 1 com quem roda o --follow (as primeiras pessoas da lista), da mais recente para a mais antiga. */
const CHATS: { slug: string; text: string }[] = [
  { slug: 'ana', text: '[TESTE] Vai no happy hour de sexta?' },
  { slug: 'bruno', text: '[TESTE] Viu o show de sábado?' },
  { slug: 'gabi', text: '[TESTE] Karaokê confirmado!' },
  { slug: 'carla', text: '[TESTE] Bora na feira domingo?' },
  { slug: 'joao', text: '[TESTE] Samba hoje às 18h.' },
  { slug: 'marina', text: '[TESTE] Terminei o livro do clube.' },
  { slug: 'felipe', text: '[TESTE] Pedal amanhã 7h?' },
  { slug: 'isa', text: '[TESTE] A exposição vale muito a pena.' },
];

/** Grupos de exemplo (o dono é a primeira pessoa; quem roda o --follow entra como membro). */
const GROUPS: { name: string; slugs: string[]; text: string }[] = [
  { name: '[TESTE] Rolê de sexta', slugs: ['ana', 'bruno', 'carla', 'diego'], text: '[TESTE] Onde vai ser hoje?' },
  { name: '[TESTE] Pedal de domingo', slugs: ['felipe', 'lucas', 'karina'], text: '[TESTE] Saída às 7h do parque.' },
];

const directKeyOf = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
try {
  let removed: { count: number } | undefined;
  if (process.argv.includes('--clear')) {
    // Mensagens não somem junto com quem enviou: apaga antes as conversas e grupos de exemplo e o que elas mandaram.
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.group.deleteMany({ where: { ownerId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { type: 'DIRECT', participants: { some: { userId: { in: ids } } } } });
    await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
    removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (removed) {
    console.log(`Apagadas ${removed.count} conta(s) de exemplo, com posts e vínculos. Pronto.`);
  } else {
    const demoIds: string[] = [];
    let createdUsers = 0;
    let createdPosts = 0;
    for (const p of PEOPLE) {
      const email = `${p.slug}${DOMAIN}`;
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            id: randomUUID(),
            email,
            passwordHash: NO_LOGIN,
            birthDate: new Date('1995-06-15T00:00:00.000Z'),
            termsAcceptedAt: new Date(),
            termsVersion: TERMS_VERSION,
            profile: { create: { username: `teste_${p.slug}`, displayName: `[TESTE] ${p.name}`, bio: p.bio } },
            settings: { create: {} },
          },
        });
        createdUsers++;
      }
      demoIds.push(user.id);
      if ((await prisma.post.count({ where: { authorId: user.id } })) === 0) {
        for (const [i, caption] of p.posts.entries()) {
          await prisma.post.create({
            data: { id: randomUUID(), authorId: user.id, caption, images: { create: [{ id: randomUUID(), position: 0, mime: 'image/png', data: solidPng(640, 640, p.color.map((c) => Math.max(0, c - i * 40)) as [number, number, number]) }] } },
          });
          createdPosts++;
        }
      }
    }
    console.log(`Pessoas de exemplo: ${createdUsers} criada(s), ${PEOPLE.length - createdUsers} já existiam. Posts criados: ${createdPosts}.`);

    const target = arg('follow')?.trim().replace(/^@/, '').toLowerCase();
    if (target) {
      const profile = await prisma.profile.findUnique({ where: { username: target } });
      if (!profile) throw new Error(`Não achei o usuário @${target}.`);
      for (const id of demoIds.filter((x) => x !== profile.userId)) {
        await prisma.follow.upsert({ where: { followerId_followeeId: { followerId: profile.userId, followeeId: id } }, create: { followerId: profile.userId, followeeId: id, status: 'ACCEPTED' }, update: {} });
        await prisma.follow.upsert({ where: { followerId_followeeId: { followerId: id, followeeId: profile.userId } }, create: { followerId: id, followeeId: profile.userId, status: 'ACCEPTED' }, update: {} });
      }
      console.log(`@${target} e as pessoas de exemplo agora se seguem (amigos).`);

      const idOf = (slug: string) => demoIds[PEOPLE.findIndex((p) => p.slug === slug)]!;
      const me = profile.userId;
      const now = Date.now();
      let chats = 0;
      for (const [i, chat] of CHATS.entries()) {
        const other = idOf(chat.slug);
        const directKey = directKeyOf(me, other);
        if (await prisma.conversation.findUnique({ where: { directKey } })) continue;
        const at = new Date(now - (i + 1) * 37 * 60_000);
        await prisma.conversation.create({
          data: { id: randomUUID(), type: 'DIRECT', directKey, createdAt: at, participants: { create: [{ userId: me }, { userId: other }] }, messages: { create: [{ id: randomUUID(), senderId: other, body: chat.text, createdAt: at }] } },
        });
        chats++;
      }
      let groups = 0;
      for (const [i, g] of GROUPS.entries()) {
        const ownerId = idOf(g.slugs[0]!);
        const found = await prisma.group.findFirst({ where: { ownerId, name: g.name }, include: { conversation: true } });
        if (found) {
          // O grupo já existe (de outro --follow): só coloca esta pessoa nele.
          await prisma.groupMember.upsert({ where: { groupId_userId: { groupId: found.id, userId: me } }, create: { groupId: found.id, userId: me }, update: {} });
          if (found.conversation) await prisma.conversationParticipant.upsert({ where: { conversationId_userId: { conversationId: found.conversation.id, userId: me } }, create: { conversationId: found.conversation.id, userId: me }, update: {} });
          continue;
        }
        const members = [...g.slugs.map(idOf), me];
        const at = new Date(now - (i + 2) * 53 * 60_000);
        await prisma.group.create({
          data: {
            id: randomUUID(),
            ownerId,
            name: g.name,
            createdAt: at,
            members: { create: members.map((userId) => ({ userId, role: userId === ownerId ? 'OWNER' : 'MEMBER', joinedAt: at })) },
            conversation: { create: { id: randomUUID(), type: 'GROUP', createdAt: at, participants: { create: members.map((userId) => ({ userId })) }, messages: { create: [{ id: randomUUID(), senderId: ownerId, body: g.text, createdAt: at }] } } },
          },
        });
        groups++;
      }
      console.log(`Conversas de exemplo com @${target}: ${chats} criada(s); grupos: ${groups} criado(s).`);
    }
    console.log('Elas aparecem como "[TESTE]" e não conseguem entrar no app. Para apagar: npm run seed:demo -- --clear');
  }
} finally {
  await prisma.$disconnect();
}
