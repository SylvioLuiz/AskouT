// Importa EVENTOS REAIS de fontes autorizadas para o AskouT, só os que fazem sentido para o app (encontro de pessoas).
//
// Fontes: Juicy Santos, agenda da Prefeitura de Mogi das Cruzes, Centro Cultural São Paulo e programação do Sesc SP
// (uso autorizado pelo responsável do AskouT). Cinema fica de fora.
// Cada evento guarda o link da página de origem na descrição, como crédito.
//
//   npm run import:events                  SIMULAÇÃO (padrão): busca, filtra e mostra o que entraria e o que ficou de fora. Não grava.
//   npm run import:events -- --apply       grava no banco de DATABASE_URL (confira o banco de destino antes!)
//
// No servidor (Dockerfile) roda com --apply a cada deploy, em segundo plano; IMPORT_EVENTS=off desliga.
//
// Para gravar é preciso DATABASE_URL e GOOGLE_PLACES_API_KEY (o local de cada evento é achado no Google, na mesma forma que o
// app abre um "lugar do Google": externalKey google:ID). Evento cujo local o Google não acha fica de fora e aparece no relatório.
// Rodar de novo não duplica (o id do evento vem da fonte). Eventos de teste (`isSample`) NÃO são tocados por este script.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { GooglePlaceSource } from '../src/infra/google/google-place-source.ts';
import { fetchJuicyEvents } from '../src/infra/event-import/juicy-santos.ts';
import { fetchMogiEvents } from '../src/infra/event-import/mogi-prefeitura.ts';
import { fetchCcspEvents } from '../src/infra/event-import/ccsp.ts';
import { fetchSescEvents } from '../src/infra/event-import/sesc.ts';
import { classifyEvent, IMPORT_TAGS } from '../src/infra/event-import/niche.ts';
import type { ImportedEvent } from '../src/infra/event-import/niche.ts';
import type { ExternalPlace } from '../src/core/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_KM = 40;

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const envFile = join(here, '..', '.env');
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
}

function uuidOf(text: string): string {
  const h = createHash('md5').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const words = (s: string): string[] => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** O nome do Google tem de lembrar o nome do evento-local (metade das palavras ou mais) e estar na região. */
function bestPlace(venueName: string, center: { lat: number; lng: number }, places: readonly ExternalPlace[]): ExternalPlace | undefined {
  const want = words(venueName);
  if (want.length === 0) return undefined;
  return places.find((p) => {
    const km = Math.hypot((p.lat - center.lat) * 111, (p.lng - center.lng) * 102);
    if (km > MAX_KM) return false;
    const got = new Set(words(p.name));
    return want.filter((w) => got.has(w)).length / want.length >= 0.5;
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (apply && env('IMPORT_EVENTS') === 'off') return console.log('[importar] IMPORT_EVENTS=off: importação desligada.');
  const now = new Date();
  console.log(`[importar] ${apply ? 'GRAVANDO' : 'simulação (nada será gravado; use --apply para gravar)'}`);
  const mogi = await fetchMogiEvents(now).catch((e: unknown) => {
    console.log(`[importar] Mogi indisponível: ${e instanceof Error ? e.message : e}`);
    return [] as ImportedEvent[];
  });
  const optional = async (name: string, load: () => Promise<ImportedEvent[]>): Promise<ImportedEvent[]> => {
    try {
      return await load();
    } catch (e: unknown) {
      console.log(`[importar] ${name} indisponível: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  };
  const ccsp = await optional('CCSP', () => fetchCcspEvents(now));
  const sesc = await optional('Sesc', () => fetchSescEvents(now));
  const fetched = [...(await fetchJuicyEvents(now)), ...mogi, ...ccsp, ...sesc];
  const kept: { event: ImportedEvent; kind: Extract<ReturnType<typeof classifyEvent>, { keep: true }>['kind'] }[] = [];
  const dropped: { event: ImportedEvent; reason: string }[] = [];
  for (const event of fetched) {
    const verdict = classifyEvent(event);
    if (verdict.keep) kept.push({ event, kind: verdict.kind });
    else dropped.push({ event, reason: verdict.reason });
  }
  console.log(`[importar] todas as fontes: ${fetched.length} evento(s) futuro(s); ${kept.length} no nicho, ${dropped.length} fora.`);
  for (const d of dropped) console.log(`  fora: ${d.event.title} (${d.reason})`);
  for (const k of kept) console.log(`  entra [${k.kind}]: ${k.event.title} — ${k.event.venueName} — ${k.event.startsAt.toISOString().slice(0, 16)}Z${k.event.isFree ? ' (grátis)' : ''}`);
  if (!apply) return;

  const url = env('DATABASE_URL');
  const key = env('GOOGLE_PLACES_API_KEY');
  if (!url) return console.log('[importar] sem DATABASE_URL: nada gravado.');
  if (!key) return console.log('[importar] sem GOOGLE_PLACES_API_KEY: não dá para achar os locais. Nada gravado.');
  const google = new GooglePlaceSource({ apiKey: key, dailyLimit: 200 });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const venueByName = new Map<string, string | undefined>();
    let created = 0;
    let existing = 0;
    const noPlace: string[] = [];
    for (const { event, kind } of kept) {
      const nameKey = `${event.area.name}|${event.venueName.toLowerCase()}`;
      if (!venueByName.has(nameKey)) {
        const found = await google.search(`${event.venueName} ${event.address ?? event.area.name}`, event.area, 5);
        const place = found.available ? bestPlace(event.venueName, event.area, found.places) : undefined;
        let venueId: string | undefined;
        if (place) {
          const externalKey = `google:${place.externalId}`;
          let venue = await prisma.venue.findUnique({ where: { externalKey } });
          if (!venue) {
            try {
              venue = await prisma.venue.create({
                data: {
                  id: uuidOf(`askout-import:venue:${externalKey}`),
                  name: place.name.slice(0, 80),
                  address: place.address ? place.address.slice(0, 200) : null,
                  category: place.category ? place.category.slice(0, 40) : null,
                  lat: place.lat,
                  lng: place.lng,
                  externalKey,
                  photoRef: place.photoRef ?? null,
                  photoAuthor: place.photoAuthor ?? null,
                },
              });
            } catch {
              venue = await prisma.venue.findUnique({ where: { externalKey } });
            }
          }
          venueId = venue?.id;
        }
        venueByName.set(nameKey, venueId);
      }
      const venueId = venueByName.get(nameKey);
      if (!venueId) {
        noPlace.push(`${event.title} (${event.venueName})`);
        continue;
      }
      const id = uuidOf(`askout-import:${event.source}:${event.sourceId}`);
      if (await prisma.placeEvent.findUnique({ where: { id }, select: { id: true } })) {
        existing++;
        continue;
      }
      const credit = `Fonte: ${event.sourceName} — ${event.link}`;
      await prisma.placeEvent.create({
        data: {
          id,
          venueId,
          title: event.title,
          description: [event.description, credit].filter((t) => t !== '').join('\n\n').slice(0, 1500),
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          kind,
          isFree: event.isFree,
          imageUrl: event.imageUrl,
          tags: IMPORT_TAGS[kind],
          isSample: false,
        },
      });
      created++;
    }
    console.log(`[importar] gravados: ${created}; já existiam: ${existing}; sem local no Google: ${noPlace.length}.`);
    for (const n of noPlace) console.log(`  sem local: ${n}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[importar] erro:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
