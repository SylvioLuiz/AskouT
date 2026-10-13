import { notFound, validationError } from './errors.ts';
import { fold, normalizeTag } from './explore-match.ts';
import { distanceMeters } from './geo.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';
import type { EventKind, PlaceEventRecord, VenueRecord } from './types.ts';
import { EVENT_KINDS } from './types.ts';

export const EXPLORE_DEFAULT_RADIUS_KM = 10;
export const EXPLORE_MAX_RADIUS_KM = 50;
export const EXPLORE_MAX_SPAN_DAYS = 62;
export const EXPLORE_DEFAULT_SPAN_DAYS = 30;
export const EXPLORE_QUERY_MAX = 80;
/** Raio máximo para a busca de lugares em fontes externas (OpenStreetMap/Google). */
export const EXPLORE_EXTERNAL_MAX_RADIUS_M = 10_000;
const EVENT_LIMIT = 40;
const VENUE_LIMIT = 15;
const TAG_LIMIT = 10;
const PEOPLE_LIMIT = 10;
const DAY_MS = 86_400_000;

export interface ExploreInput {
  q?: unknown;
  lat?: unknown;
  lng?: unknown;
  radiusKm?: unknown;
  from?: unknown;
  to?: unknown;
  kind?: unknown;
  free?: unknown;
}

export interface ExploreEventItem {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  venue: { id: string; name: string; address: string | null; category: string | null; lat: number; lng: number };
  distanceM: number | null;
}

export interface ExplorePlaceItem {
  key: string;
  source: 'ASKOUT' | 'GOOGLE' | 'OSM';
  name: string;
  category: string | null;
  address: string | null;
  lat: number;
  lng: number;
  sample: boolean;
  distanceM: number | null;
  rating: number | null;
  ratingCount: number | null;
  photoRef: string | null;
  photoAuthor: string | null;
  mapsUri: string | null;
}

export interface ExploreView {
  /** NEARBY: sem texto (eventos perto); TAG: busca por #; SEARCH: busca por texto. */
  mode: 'NEARBY' | 'TAG' | 'SEARCH';
  q: string;
  /** Houve posição para filtrar por distância. */
  located: boolean;
  radiusKm: number;
  from: string;
  to: string;
  events: ExploreEventItem[];
  places: ExplorePlaceItem[];
  people: Awaited<ReturnType<ProfileService['search']>>;
  tags: { tag: string; count: number }[];
  /** false quando a fonte externa de lugares não respondeu. */
  placesAvailable: boolean;
}

function parseNumber(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) throw validationError('Valor inválido', { [field]: 'Informe um número' });
  return n;
}

function parseDate(raw: unknown, field: string): Date | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const d = typeof raw === 'string' ? new Date(raw) : undefined;
  if (!d || Number.isNaN(d.getTime())) throw validationError('Data inválida', { [field]: 'Use o formato ISO 8601' });
  return d;
}

function parseBool(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === '1' || raw === 1;
}

function toEventItem(event: PlaceEventRecord, venue: VenueRecord, distanceM: number | null): ExploreEventItem {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    kind: event.kind,
    isFree: event.isFree,
    imageUrl: event.imageUrl,
    tags: [...event.tags],
    sample: event.isSample || venue.isSample,
    venue: { id: venue.id, name: venue.name, address: venue.address, category: venue.category, lat: venue.lat, lng: venue.lng },
    distanceM: distanceM === null ? null : Math.round(distanceM),
  };
}

export class ExploreService {
  private readonly deps: CoreDeps;
  private readonly profiles: ProfileService;

  constructor(deps: CoreDeps, profiles: ProfileService) {
    this.deps = deps;
    this.profiles = profiles;
  }

  /**
   * Explorar: sem texto devolve os eventos perto; com texto busca eventos, lugares, pessoas e hashtags (`#texto` só hashtags e eventos).
   * A posição vale só para esta consulta; nada é guardado.
   */
  async search(actorId: string, input: ExploreInput): Promise<ExploreView> {
    const { places, placeSource, clock } = this.deps;

    const rawQ = typeof input.q === 'string' ? input.q.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (rawQ.length > EXPLORE_QUERY_MAX || /[\u0000-\u001f\u007f]/.test(rawQ)) throw validationError('Busca inválida', { q: `Até ${EXPLORE_QUERY_MAX} caracteres, sem caracteres de controle` });

    const lat = parseNumber(input.lat, 'lat');
    const lng = parseNumber(input.lng, 'lng');
    if ((lat === undefined) !== (lng === undefined)) throw validationError('Posição incompleta', { lat: 'Envie lat e lng juntos' });
    if (lat !== undefined && lng !== undefined && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw validationError('Posição inválida', { lat: 'Coordenadas fora do intervalo' });
    const center = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

    const radiusKm = parseNumber(input.radiusKm, 'radiusKm') ?? EXPLORE_DEFAULT_RADIUS_KM;
    if (radiusKm < 1 || radiusKm > EXPLORE_MAX_RADIUS_KM) throw validationError('Raio inválido', { radiusKm: `Entre 1 e ${EXPLORE_MAX_RADIUS_KM} km` });
    const radiusM = Math.round(radiusKm * 1000);

    const now = clock.now();
    const from = parseDate(input.from, 'from') ?? now;
    const to = parseDate(input.to, 'to') ?? new Date(from.getTime() + EXPLORE_DEFAULT_SPAN_DAYS * DAY_MS);
    if (to <= from) throw validationError('Período inválido', { to: 'O fim precisa ser depois do início' });
    if (to.getTime() - from.getTime() > EXPLORE_MAX_SPAN_DAYS * DAY_MS) throw validationError('Período longo demais', { to: `No máximo ${EXPLORE_MAX_SPAN_DAYS} dias` });

    let kind: EventKind | undefined;
    if (input.kind !== undefined && input.kind !== null && input.kind !== '') {
      if (typeof input.kind !== 'string' || !EVENT_KINDS.includes(input.kind as EventKind)) throw validationError('Tipo de evento inválido', { kind: 'Tipo desconhecido' });
      kind = input.kind as EventKind;
    }
    const freeOnly = parseBool(input.free);

    const isTag = rawQ.startsWith('#');
    const tag = isTag ? normalizeTag(rawQ) : '';
    const text = isTag ? '' : rawQ;
    const base = { center, radiusM: center ? radiusM : undefined, from, to, kind, freeOnly, limit: EVENT_LIMIT };

    const empty: ExploreView = {
      mode: rawQ === '' ? 'NEARBY' : isTag ? 'TAG' : 'SEARCH',
      q: rawQ,
      located: Boolean(center),
      radiusKm,
      from: from.toISOString(),
      to: to.toISOString(),
      events: [],
      places: [],
      people: [],
      tags: [],
      placesAvailable: true,
    };

    if (rawQ === '') {
      const found = await places.searchEvents(base);
      return { ...empty, events: found.map((r) => toEventItem(r.event, r.venue, r.distanceM)) };
    }

    if (isTag) {
      const [found, tags] = await Promise.all([
        tag ? places.searchEvents({ ...base, tagPrefix: tag }) : Promise.resolve([]),
        places.listTags(tag, from, to, TAG_LIMIT),
      ]);
      return { ...empty, events: found.map((r) => toEventItem(r.event, r.venue, r.distanceM)), tags };
    }

    // Texto livre: eventos, hashtags, lugares e pessoas.
    const foldedTag = normalizeTag(text);
    const [found, tags, venues, people] = await Promise.all([
      places.searchEvents({ ...base, text }),
      foldedTag ? places.listTags(foldedTag, from, to, TAG_LIMIT) : Promise.resolve([]),
      places.searchVenues(text, center, radiusM, VENUE_LIMIT),
      text.length >= 2 ? this.profiles.search(actorId, text, PEOPLE_LIMIT).catch(() => []) : Promise.resolve([]),
    ]);

    const placeItems: ExplorePlaceItem[] = venues.map(({ venue, distanceM }) => ({
      key: `askout:${venue.id}`,
      source: 'ASKOUT',
      name: venue.name,
      category: venue.category,
      address: venue.address,
      lat: venue.lat,
      lng: venue.lng,
      sample: venue.isSample,
      distanceM: distanceM === null ? null : Math.round(distanceM),
      rating: null,
      ratingCount: null,
      photoRef: null,
      photoAuthor: null,
      mapsUri: null,
    }));

    let placesAvailable = true;
    // Lugares de fora (Google/OSM) só quando há posição e nenhum filtro de evento (tipo/grátis) escondendo-os.
    if (center && !kind && !freeOnly && text.length >= 2) {
      const ext = await placeSource.nearby(center, Math.min(radiusM, EXPLORE_EXTERNAL_MAX_RADIUS_M), 60);
      placesAvailable = ext.available;
      const needle = fold(text);
      const seen = new Set(placeItems.map((p) => fold(p.name)));
      const extra = ext.places
        .filter((p) => fold(p.name).includes(needle))
        .map((p) => ({ p, d: distanceMeters(center, { lat: p.lat, lng: p.lng }) }))
        .sort((a, b) => a.d - b.d);
      for (const { p, d } of extra) {
        if (placeItems.length >= VENUE_LIMIT) break;
        const name = fold(p.name);
        if (seen.has(name)) continue;
        seen.add(name);
        placeItems.push({
          key: `${p.source.toLowerCase()}:${p.externalId}`,
          source: p.source,
          name: p.name,
          category: p.category,
          address: null,
          lat: p.lat,
          lng: p.lng,
          sample: false,
          distanceM: Math.round(d),
          rating: p.rating ?? null,
          ratingCount: p.ratingCount ?? null,
          photoRef: p.photoRef ?? null,
          photoAuthor: p.photoAuthor ?? null,
          mapsUri: p.mapsUri ?? null,
        });
      }
    }

    return { ...empty, events: found.map((r) => toEventItem(r.event, r.venue, r.distanceM)), places: placeItems, people, tags, placesAvailable };
  }

  /** Um evento pelo id. Com posição, inclui a distância (usada só nesta resposta). */
  async event(actorId: string, id: unknown, input: { lat?: unknown; lng?: unknown } = {}): Promise<ExploreEventItem> {
    void actorId;
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw notFound('Evento não encontrado');
    const lat = parseNumber(input.lat, 'lat');
    const lng = parseNumber(input.lng, 'lng');
    if ((lat === undefined) !== (lng === undefined)) throw validationError('Posição incompleta', { lat: 'Envie lat e lng juntos' });
    const found = await this.deps.places.findEvent(id);
    if (!found) throw notFound('Evento não encontrado');
    const distance = lat !== undefined && lng !== undefined ? distanceMeters({ lat, lng }, found.venue) : null;
    return toEventItem(found.event, found.venue, distance);
  }
}
