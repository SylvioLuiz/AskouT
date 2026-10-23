// Cria pessoas e posts de EXEMPLO para o primeiro acesso não cair num app vazio.
// Tudo é marcado "[TESTE]" e as contas usam e-mail @teste.askout.invalid, que não existe: ninguém consegue entrar nelas.
//
//   npm run seed:demo                       (cria/atualiza as pessoas e posts de exemplo)
//   npm run seed:demo -- --follow sylvio    (e faz @sylvio e as pessoas de exemplo se seguirem: viram amigos)
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
];

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
try {
  const removed = process.argv.includes('--clear') ? await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } }) : undefined;
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
    }
    console.log('Elas aparecem como "[TESTE]" e não conseguem entrar no app. Para apagar: npm run seed:demo -- --clear');
  }
} finally {
  await prisma.$disconnect();
}
