// Histórico de EXEMPLO em lugares reais de Mogi das Cruzes, Vila Mariana (São Paulo) e Santos.
// Roda no servidor de produção logo depois das migrations (ver apps/api/Dockerfile), porque precisa da chave do Google
// (GOOGLE_PLACES_API_KEY), que só existe lá.
//
// O que faz, uma vez só por banco:
//   1. Busca no Google bares, restaurantes, baladas, casas de show etc. em cada região.
//   2. Cria o local no AskouT como a página "abrir lugar do Google" já faz (externalKey google:ID), se ainda não existir.
//      Local que já tem dono, é organização ou foi criado por usuário fica de fora.
//   3. Cria eventos PASSADOS de exemplo nesses locais, espalhados pelos últimos 2 anos (isSample: selo "Exemplo de teste"),
//      com "quem vai" entre as pessoas de exemplo da migration 20270120120000_sample_event_history.
//   4. Grava a marca `seed.historyPlaces` em AppSetting: com ela, os próximos deploys não fazem nada.
//   5. Depois, cria alguns eventos FUTUROS de exemplo (próximos 30 dias) nesses lugares, para o Explorar ter o que mostrar
//      (marca própria `seed.upcomingPlaces`).
//
// Sem chave do Google ou sem resposta dele, não grava a marca e tenta de novo no próximo deploy. Nunca derruba a API:
// o Dockerfile roda isto em segundo plano.
//
//   npx tsx apps/api/scripts/seed-history-places.ts            (como o servidor roda)
//   npx tsx apps/api/scripts/seed-history-places.ts --force    (roda de novo mesmo com a marca; não duplica)
//
// Para apagar os eventos de exemplo (daqui e da migration; as presenças caem junto):
//   DELETE FROM "PlaceEvent" WHERE "isSample" AND description IN ('Evento de exemplo do histórico do AskouT.', 'Evento de exemplo do AskouT.');
// Os locais criados ficam, como qualquer lugar aberto do Google pelo app.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, type EventKind } from '@prisma/client';
import { GooglePlaceSource } from '../src/infra/google/google-place-source.ts';
import type { ExternalPlace } from '../src/core/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MARK = 'seed.historyPlaces';
const DESCRIPTION = 'Evento de exemplo do histórico do AskouT.';
const UPCOMING_MARK = 'seed.upcomingPlaces';
const UPCOMING_DESCRIPTION = 'Evento de exemplo do AskouT.';
const DEMO_EMAIL = /^hist-[a-z]+@teste\.askout\.invalid$/;
const DAY = 86_400_000;

const AREAS = [
  { name: 'Mogi das Cruzes', lat: -23.5225, lng: -46.1883 },
  { name: 'Vila Mariana', lat: -23.5891, lng: -46.6346 },
  { name: 'Santos', lat: -23.9663, lng: -46.3336 },
];
const QUERIES = ['bar', 'restaurante', 'balada', 'casa de show', 'pub', 'teatro'];
const PER_QUERY = 3;
const PER_AREA = 12;
const EVENTS_PER_VENUE = 18;

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const envFile = join(here, '..', '.env');
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
}

/** uuid fixo a partir de um texto (mesmo formato do md5(...)::uuid da migration): rodar de novo não duplica. */
function uuidOf(text: string): string {
  const h = createHash('md5').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function hashOf(text: string): number {
  return createHash('md5').update(text).digest().readUInt32BE(0);
}
const pick = <T>(list: readonly T[], h: number): T => list[h % list.length]!;

function kindFor(category: string, h: number): EventKind {
  const c = category.toLowerCase();
  if (/(cinema|movie)/.test(c)) return 'CINEMA';
  if (/(theat|teatro|performing)/.test(c)) return pick(['THEATER', 'THEATER', 'SHOW'] as const, h);
  if (/(gallery|museum|art)/.test(c)) return 'EXHIBITION';
  if (/(park|beach|praia)/.test(c)) return pick(['OUTDOOR', 'OUTDOOR', 'SPORT'] as const, h);
  if (/(stadium|gym|sport)/.test(c)) return 'SPORT';
  if (/(night|club|concert|live_music|event_venue)/.test(c)) return pick(['NIGHT', 'NIGHT', 'SHOW'] as const, h);
  if (/(bar|pub|brewery|wine)/.test(c)) return pick(['SHOW', 'NIGHT', 'GASTRONOMY', 'SPORT', 'SHOW'] as const, h);
  if (/(restaurant|cafe|food|bakery|coffee|pizza|burger)/.test(c)) return pick(['GASTRONOMY', 'GASTRONOMY', 'SHOW'] as const, h);
  return pick(['SHOW', 'GASTRONOMY', 'OTHER'] as const, h);
}

const TITLES: Record<EventKind, string[]> = {
  SHOW: ['Show acústico', 'Noite de MPB', 'Roda de samba', 'Pagode ao vivo', 'Tributo ao rock nacional', 'Jazz na sexta', 'Forró pé de serra', 'Voz e violão'],
  NIGHT: ['Festa anos 2000', 'Noite eletrônica', 'Baile funk', 'Sexta de house', 'Flashback', 'Festa open format'],
  GASTRONOMY: ['Festival de hambúrguer', 'Noite da pizza', 'Feijoada de sábado', 'Harmonização de vinhos', 'Rodízio de petiscos', 'Brunch de domingo', 'Degustação de cervejas'],
  SPORT: ['Final do campeonato no telão', 'Clássico no telão', 'Corrida de rua 5 km', 'Torneio de futevôlei'],
  THEATER: ['Stand-up comedy', 'Peça em cartaz', 'Improviso', 'Monólogo'],
  CINEMA: ['Sessão de clássicos', 'Maratona de terror', 'Pré-estreia', 'Mostra de curtas'],
  EXHIBITION: ['Abertura de exposição', 'Feira de arte', 'Exposição de fotografia', 'Visita guiada'],
  OUTDOOR: ['Piquenique no parque', 'Yoga ao ar livre', 'Feirinha de domingo', 'Pôr do sol com música'],
  DIGITAL: ['Live especial'],
  OTHER: ['Encontro da comunidade', 'Quiz no bar', 'Karaokê'],
};
const TAGS: Record<EventKind, string[]> = {
  SHOW: ['musicaaovivo', 'show'], NIGHT: ['balada', 'festa'], GASTRONOMY: ['gastronomia', 'comida'], SPORT: ['esporte'],
  THEATER: ['teatro'], CINEMA: ['cinema'], EXHIBITION: ['arte', 'exposicao'], OUTDOOR: ['arlivre'], DIGITAL: [], OTHER: [],
};
const START_HOUR: Record<EventKind, number[]> = {
  NIGHT: [23], SHOW: [21], THEATER: [20], CINEMA: [19, 21], GASTRONOMY: [12, 19, 20], EXHIBITION: [14], OUTDOOR: [9], SPORT: [16], DIGITAL: [20], OTHER: [19],
};
const HOURS: Record<EventKind, number> = { NIGHT: 5, SHOW: 3, THEATER: 2, CINEMA: 3, GASTRONOMY: 3, EXHIBITION: 4, OUTDOOR: 4, SPORT: 3, DIGITAL: 2, OTHER: 3 };

/** Meia-noite de hoje em São Paulo (UTC-3, sem horário de verão desde 2019), em UTC. */
function todaySaoPaulo(now: number): number {
  const local = now - 3 * 3_600_000;
  return Math.floor(local / DAY) * DAY + 3 * 3_600_000;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const apiKey = env('GOOGLE_PLACES_API_KEY');
  const url = env('DATABASE_URL');
  if (!url) return console.log('[historico] sem DATABASE_URL: nada a fazer.');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await runHistory(prisma, force, apiKey);
    await runUpcoming(prisma, force);
  } finally {
    await prisma.$disconnect();
  }
}

async function demoPeople(prisma: PrismaClient): Promise<{ id: string; email: string; createdAt: Date }[]> {
  const rows = await prisma.user.findMany({ where: { email: { endsWith: '@teste.askout.invalid', startsWith: 'hist-' } }, select: { id: true, email: true, createdAt: true }, orderBy: { email: 'asc' } });
  return rows.filter((u) => DEMO_EMAIL.test(u.email));
}

async function runHistory(prisma: PrismaClient, force: boolean, apiKey: string | undefined): Promise<void> {
  {
    if (!force && (await prisma.appSetting.findUnique({ where: { key: MARK } }))) return console.log('[historico] já rodou neste banco: nada a fazer.');
    if (!apiKey) return console.log('[historico] sem GOOGLE_PLACES_API_KEY: tento de novo no próximo deploy.');
    const people = await demoPeople(prisma);
    if (people.length === 0) return console.log('[historico] pessoas de exemplo não encontradas (migration 20270120120000): nada a fazer.');

    const google = new GooglePlaceSource({ apiKey, dailyLimit: 60 });
    let googleAnswered = false;
    const venues: { id: string; category: string; area: string }[] = [];
    for (const area of AREAS) {
      const found = new Map<string, ExternalPlace>();
      for (const q of QUERIES) {
        const res = await google.search(`${q} em ${area.name}`, { lat: area.lat, lng: area.lng }, 10);
        if (res.available) googleAnswered = true;
        // Só o que está de fato na região (até ~6 km do centro).
        const near = res.places.filter((p) => Math.hypot((p.lat - area.lat) * 111, (p.lng - area.lng) * 102) <= 6);
        for (const p of near.slice(0, PER_QUERY)) if (!found.has(p.externalId)) found.set(p.externalId, p);
      }
      for (const p of [...found.values()].slice(0, PER_AREA)) {
        const key = `google:${p.externalId}`;
        let venue = await prisma.venue.findUnique({ where: { externalKey: key } });
        if (!venue) {
          try {
            venue = await prisma.venue.create({
              data: {
                id: uuidOf(`askout-historico:venue:${key}`),
                name: p.name.slice(0, 80),
                address: p.address ? p.address.slice(0, 200) : null,
                category: p.category ? p.category.slice(0, 40) : null,
                lat: p.lat,
                lng: p.lng,
                externalKey: key,
                photoRef: p.photoRef ?? null,
                photoAuthor: p.photoAuthor ?? null,
              },
            });
          } catch {
            venue = await prisma.venue.findUnique({ where: { externalKey: key } });
          }
        }
        if (!venue || venue.ownerId || venue.isOrganization || venue.isUserCreated) continue;
        venues.push({ id: venue.id, category: venue.category ?? '', area: area.name });
      }
    }
    if (!googleAnswered) return console.log('[historico] o Google não respondeu: tento de novo no próximo deploy.');

    const now = Date.now();
    const today = todaySaoPaulo(now);
    const events: { id: string; venueId: string; title: string; description: string; startsAt: Date; endsAt: Date; kind: EventKind; isFree: boolean; tags: string[]; isSample: true; createdAt: Date; updatedAt: Date }[] = [];
    for (const v of venues) {
      for (let n = 0; n < EVENTS_PER_VENUE; n++) {
        const h = hashOf(`askout-historico:g:${v.id}:${n}`);
        // Espalhados de ~730 a ~3 dias atrás, com um empurrão aleatório para não cair tudo no mesmo dia da semana.
        const daysAgo = Math.floor(3 + ((EVENTS_PER_VENUE - 1 - n) * 720) / EVENTS_PER_VENUE + (h % 30));
        const kind = kindFor(v.category, h);
        const startsAt = new Date(today - daysAgo * DAY + pick(START_HOUR[kind], h >>> 4) * 3_600_000);
        const createdAt = new Date(startsAt.getTime() - (7 + ((h >>> 8) % 14)) * DAY);
        events.push({
          id: uuidOf(`askout-historico:g:${v.id}:${n}`),
          venueId: v.id,
          title: pick(TITLES[kind], h >>> 3),
          description: DESCRIPTION,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOURS[kind] * 3_600_000),
          kind,
          isFree: (h >>> 12) % 3 === 0,
          tags: TAGS[kind],
          isSample: true,
          createdAt,
          updatedAt: createdAt,
        });
      }
    }
    const createdEvents = (await prisma.placeEvent.createMany({ data: events, skipDuplicates: true })).count;

    const attendance: { id: string; userId: string; placeEventId: string; createdAt: Date; onProfile: boolean }[] = [];
    for (const e of events) {
      const k = 3 + (hashOf(`askout-historico:k:${e.id}`) % 10);
      const ranked = people
        .filter((p) => p.createdAt.getTime() < e.startsAt.getTime() - DAY)
        .map((p) => ({ p, h: hashOf(`askout-historico:a:${e.id}${p.id}`) }))
        .sort((a, b) => a.h - b.h)
        .slice(0, k);
      for (const { p, h } of ranked) {
        attendance.push({
          id: uuidOf(`askout-historico:att:${e.id}${p.id}`),
          userId: p.id,
          placeEventId: e.id,
          createdAt: new Date(Math.max(p.createdAt.getTime(), e.startsAt.getTime() - (1 + (h % 6)) * DAY)),
          onProfile: h % 3 !== 0,
        });
      }
    }
    const createdGoing = (await prisma.eventAttendance.createMany({ data: attendance, skipDuplicates: true })).count;

    await prisma.appSetting.upsert({
      where: { key: MARK },
      create: { key: MARK, value: new Date(now).toISOString(), updatedAt: new Date(now) },
      update: { value: new Date(now).toISOString(), updatedAt: new Date(now) },
    });
    const byArea = AREAS.map((a) => `${a.name}: ${venues.filter((v) => v.area === a.name).length}`).join(', ');
    console.log(`[historico] locais (${byArea}); ${createdEvents} evento(s) e ${createdGoing} presença(s) criados.`);
  }
}

/**
 * Próximos eventos de EXEMPLO (selo "Exemplo de teste") nos lugares que receberam o histórico, para o Explorar não ficar vazio:
 * de 1 a 3 por lugar, nos próximos 30 dias, com algumas pessoas de exemplo confirmadas. Só depois do histórico (para os lugares
 * do Google já existirem) e uma vez por banco (marca `seed.upcomingPlaces`).
 */
async function runUpcoming(prisma: PrismaClient, force: boolean): Promise<void> {
  if (!force && (await prisma.appSetting.findUnique({ where: { key: UPCOMING_MARK } }))) return console.log('[proximos] já rodou neste banco: nada a fazer.');
  if (!(await prisma.appSetting.findUnique({ where: { key: MARK } }))) return console.log('[proximos] espera o histórico rodar primeiro.');
  const people = await demoPeople(prisma);
  const venues = await prisma.venue.findMany({
    where: { ownerId: null, isOrganization: false, isUserCreated: false, events: { some: { isSample: true, description: DESCRIPTION } } },
    select: { id: true, category: true },
    orderBy: { id: 'asc' },
  });
  const now = Date.now();
  const today = todaySaoPaulo(now);
  const events: { id: string; venueId: string; title: string; description: string; startsAt: Date; endsAt: Date; kind: EventKind; isFree: boolean; tags: string[]; isSample: true; createdAt: Date; updatedAt: Date }[] = [];
  for (const v of venues) {
    const count = 1 + (hashOf(`askout-proximos:n:${v.id}`) % 3);
    for (let n = 0; n < count; n++) {
      const h = hashOf(`askout-proximos:${v.id}:${n}`);
      const daysAhead = 1 + ((h + n * 9) % 29);
      const kind = kindFor(v.category ?? '', h);
      const startsAt = new Date(today + daysAhead * DAY + pick(START_HOUR[kind], h >>> 4) * 3_600_000);
      events.push({
        id: uuidOf(`askout-proximos:${v.id}:${n}`),
        venueId: v.id,
        title: pick(TITLES[kind], h >>> 3),
        description: UPCOMING_DESCRIPTION,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOURS[kind] * 3_600_000),
        kind,
        isFree: (h >>> 12) % 3 === 0,
        tags: TAGS[kind],
        isSample: true,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });
    }
  }
  const createdEvents = (await prisma.placeEvent.createMany({ data: events, skipDuplicates: true })).count;
  const attendance: { id: string; userId: string; placeEventId: string; createdAt: Date; onProfile: boolean }[] = [];
  for (const e of events) {
    const k = 2 + (hashOf(`askout-proximos:k:${e.id}`) % 7);
    const ranked = people.map((p) => ({ p, h: hashOf(`askout-proximos:a:${e.id}${p.id}`) })).sort((a, b) => a.h - b.h).slice(0, k);
    for (const { p, h } of ranked) attendance.push({ id: uuidOf(`askout-proximos:att:${e.id}${p.id}`), userId: p.id, placeEventId: e.id, createdAt: new Date(now), onProfile: h % 3 !== 0 });
  }
  const createdGoing = (await prisma.eventAttendance.createMany({ data: attendance, skipDuplicates: true })).count;
  await prisma.appSetting.upsert({
    where: { key: UPCOMING_MARK },
    create: { key: UPCOMING_MARK, value: new Date(now).toISOString(), updatedAt: new Date(now) },
    update: { value: new Date(now).toISOString(), updatedAt: new Date(now) },
  });
  console.log(`[proximos] ${venues.length} lugar(es); ${createdEvents} evento(s) e ${createdGoing} presença(s) criados.`);
}

main().catch((error: unknown) => {
  console.error('[historico] falhou (a API segue no ar):', error instanceof Error ? error.message : error);
  process.exitCode = 0;
});
