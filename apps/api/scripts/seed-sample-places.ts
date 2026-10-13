// Cria lugares e eventos de EXEMPLO para testar as sugestões do Flash.
// Tudo que sai daqui é marcado como teste (isSample) e aparece no app com o selo "Exemplo de teste".
//
//   npm run seed:places                                   (centro: Av. Paulista, São Paulo)
//   npm run seed:places -- --lat -23.5614 --lng -46.6559  (centro: onde você está testando)
//   npm run seed:places -- --here                         (centro: a posição que o Flash acabou de receber)
//   npm run seed:places -- --clear                        (só apaga os exemplos)
//
// Pode rodar quantas vezes quiser: apaga os exemplos anteriores e recria com horários a partir de agora.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));

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

let lat = Number(arg('lat') ?? -23.5614);
let lng = Number(arg('lng') ?? -46.6559);
if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
  throw new Error('--lat e --lng precisam ser coordenadas válidas');
}

// Deslocamentos em metros a partir do centro, para os exemplos ficarem perto de quem testa.
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
const DAY = 1440;
const SAMPLES = [
  { name: 'Bar Exemplo Um', category: 'bar', dx: 200, dy: 150, title: 'Música ao vivo', startsInMin: 30, hours: 3, kind: 'SHOW', free: true, tags: ['musica', 'aovivo'] },
  { name: 'Café Exemplo Dois', category: 'cafe', dx: -400, dy: 300, title: 'Degustação de cafés', startsInMin: -20, hours: 2, kind: 'GASTRONOMY', free: false, tags: ['cafe', 'degustacao'] },
  { name: 'Pub Exemplo Três', category: 'pub', dx: 900, dy: -500, title: 'Quiz de bar', startsInMin: 120, hours: 2, kind: 'NIGHT', free: true, tags: ['quiz', 'amigos'] },
  { name: 'Restaurante Exemplo Quatro', category: 'restaurant', dx: -1200, dy: -300, title: 'Feijoada de sábado', startsInMin: 60, hours: 4, kind: 'GASTRONOMY', free: false, tags: ['feijoada', 'samba'] },
  { name: 'Praça Exemplo Cinco', category: 'park', dx: 1800, dy: 1200, title: 'Feira de artesanato', startsInMin: 240, hours: 5, kind: 'EXHIBITION', free: true, tags: ['artesanato'] },
  { name: 'Bar Exemplo Seis', category: 'bar', dx: -2400, dy: 1500, title: 'Noite de jogos de tabuleiro', startsInMin: 300, hours: 3, kind: 'NIGHT', free: false, tags: ['jogos', 'amigos'] },
  { name: 'Cine Exemplo Sete', category: 'cinema', dx: 600, dy: 900, title: 'Sessão de clássicos', startsInMin: DAY + 120, hours: 3, kind: 'CINEMA', free: false, tags: ['cinema', 'classicos'] },
  { name: 'Teatro Exemplo Oito', category: 'theatre', dx: -800, dy: -1500, title: 'Peça de comédia', startsInMin: 2 * DAY + 60, hours: 2, kind: 'THEATER', free: false, tags: ['teatro', 'comedia'] },
  { name: 'Casa de Shows Exemplo Nove', category: 'nightclub', dx: 3000, dy: -2000, title: 'Show de rock', startsInMin: 4 * DAY, hours: 4, kind: 'SHOW', free: false, tags: ['rock', 'musica'] },
  { name: 'Galeria Exemplo Dez', category: 'gallery', dx: 1500, dy: 2500, title: 'Exposição de fotografia', startsInMin: 6 * DAY, hours: 6, kind: 'EXHIBITION', free: true, tags: ['fotografia', 'arte'] },
];

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
try {
  // --here: centraliza nas posições que o Flash recebeu agora (a de quem está testando), sem digitar coordenadas.
  if (process.argv.includes('--here')) {
    const recent = await prisma.flashPosition.findMany({ orderBy: { updatedAt: 'desc' }, take: 10 });
    if (recent.length === 0) throw new Error('Nenhuma posição do Flash encontrada. Abra um encontro, toque em "Compartilhar minha localização" e rode de novo.');
    lat = recent.reduce((sum, p) => sum + p.lat, 0) / recent.length;
    lng = recent.reduce((sum, p) => sum + p.lng, 0) / recent.length;
    console.log(`Usando a posição do Flash: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }
  const removed = await prisma.venue.deleteMany({ where: { isSample: true } });
  console.log(`Exemplos anteriores apagados: ${removed.count} lugar(es) (os eventos saem junto).`);
  if (process.argv.includes('--clear')) {
    console.log('Pronto.');
  } else {
    const now = Date.now();
    for (const s of SAMPLES) {
      const venueId = randomUUID();
      await prisma.venue.create({
        data: { id: venueId, name: `[TESTE] ${s.name}`, category: s.category, lat: lat + s.dy * M_LAT, lng: lng + s.dx * M_LNG, isSample: true },
      });
      const startsAt = new Date(now + s.startsInMin * 60_000);
      await prisma.placeEvent.create({
        data: {
          id: randomUUID(),
          venueId,
          title: `[TESTE] ${s.title}`,
          description: 'Evento de exemplo criado para testar o AskouT. Não é real.',
          startsAt,
          endsAt: new Date(startsAt.getTime() + s.hours * 3_600_000),
          kind: s.kind as 'SHOW',
          isFree: s.free,
          tags: s.tags,
          isSample: true,
        },
      });
    }
    console.log(`Criados ${SAMPLES.length} lugares com evento de exemplo em volta de ${lat}, ${lng}.`);
    console.log('Eles aparecem como "Exemplo de teste" e nunca como eventos reais.');
  }
} finally {
  await prisma.$disconnect();
}
