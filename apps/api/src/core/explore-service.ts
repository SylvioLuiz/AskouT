import { byDayAndNightlife } from './explore-priority.ts';
import { ratingView } from './venue-service.ts';
import { notFound, validationError } from './errors.ts';
import { fold, normalizeTag } from './explore-match.ts';
import { distanceMeters } from './geo.ts';
import type { CoreDeps } from './ports.ts';
import type { BoostService } from './boost-service.ts';
import type { ProfileService } from './profile-service.ts';
import type { EventKind, ExternalPlace, PlaceEventRecord, VenueHours, VenueRecord } from './types.ts';
import { EVENT_KINDS } from './types.ts';

export const EXPLORE_DEFAULT_RADIUS_KM = 10;
export const EXPLORE_MAX_RADIUS_KM = 200;
/** Busca por nome ou #tag não limita por distância: procura em qualquer lugar (o raio vale só para o que aparece ao abrir). */
export const EXPLORE_SEARCH_RADIUS_M = 1_000_000;
export const EXPLORE_MAX_OFFSET = 2000;
export const EXPLORE_MAX_SPAN_DAYS = 62;
export const EXPLORE_DEFAULT_SPAN_DAYS = 30;
export const EXPLORE_QUERY_MAX = 80;
/** Mínimo de letras para gastar uma busca paga no Google. */
const GOOGLE_SEARCH_MIN_CHARS = 3;
/** "Bombando": mínimo de pessoas com presença confirmada num evento que está acontecendo agora. */
export const EXPLORE_HOT_MIN_GOING = 5;
/** Raio máximo para a busca de lugares em fontes externas (OpenStreetMap/Google). */
export const EXPLORE_EXTERNAL_MAX_RADIUS_M = 10_000;
const EVENT_LIMIT = 40;
const VENUE_LIMIT = 15;
const MAP_PLACE_LIMIT = 40;
const TAG_LIMIT = 10;
const PEOPLE_LIMIT = 10;
/** Quantos eventos públicos criados por pessoas entram na lista do Explorar. */
const PEOPLE_EVENT_LIMIT = 15;
const DAY_MS = 86_400_000;

export interface ExploreInput {
  q?: unknown;
  lat?: unknown;
  lng?: unknown;
  radiusKm?: unknown;
  /** Quantos eventos pular, para carregar mais ao rolar. */
  offset?: unknown;
  from?: unknown;
  to?: unknown;
  kind?: unknown;
  free?: unknown;
  /** "Bombando": só eventos acontecendo agora com muita gente confirmada. */
  hot?: unknown;
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
  venue: { id: string; name: string; address: string | null; category: string | null; lat: number; lng: number; logoUrl: string | null };
  distanceM: number | null;
  /** Quem consulta já postou este evento no próprio perfil (só na consulta de um evento). */
  postedByMe?: boolean;
  /** Quantas pessoas confirmaram presença (só no filtro "Bombando"). */
  goingCount?: number;
  /** Impulsionado (anúncio pago) pelo responsável do local. A tela mostra “Patrocinado”. */
  sponsored?: boolean;
  /** Evento criado por uma pessoa (público): quem criou. Sem isto, o evento é de um local. */
  author?: { userId: string; username: string; displayName: string; avatarUrl: string | null };
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
  /** Só em local do AskouT: o que a lista mostra do perfil (logo, seguidores, horários) e se a pessoa já segue. */
  venue: ExplorePlaceVenue | null;
  /** Local impulsionado (anúncio pago). A tela mostra “Patrocinado”. */
  sponsored?: boolean;
}

export interface ExplorePlaceVenue {
  id: string;
  logoUrl: string | null;
  hours: VenueHours | null;
  followerCount: number;
  following: boolean;
  claimed: boolean;
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
  /** Há mais eventos depois destes (pedir de novo com `offset`). */
  hasMore: boolean;
  offset: number;
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
    venue: { id: venue.id, name: venue.name, address: venue.address, category: venue.category, lat: venue.lat, lng: venue.lng, logoUrl: venue.logoUrl ?? null },
    distanceM: distanceM === null ? null : Math.round(distanceM),
  };
}

/** Quantos anúncios a Home mostra de uma vez. */
export const EXPLORE_SPONSORED_LIMIT = 2;

export class ExploreService {
  private readonly deps: CoreDeps;
  private readonly profiles: ProfileService;
  private readonly boosts: BoostService;

  constructor(deps: CoreDeps, profiles: ProfileService, boosts: BoostService) {
    this.boosts = boosts;
    this.deps = deps;
    this.profiles = profiles;
  }

  /** Eventos que ainda não acabaram nos locais que a pessoa segue, para o feed. */
  async followedEvents(actorId: string): Promise<{ events: ExploreEventItem[] }> {
    const venueIds = await this.deps.places.listFollowedVenueIds(actorId);
    if (venueIds.length === 0) return { events: [] };
    const from = this.deps.clock.now();
    const to = new Date(from.getTime() + EXPLORE_DEFAULT_SPAN_DAYS * DAY_MS);
    const found = await this.deps.places.searchEvents({ from, to, venueIds, limit: 10 });
    return { events: found.map((r) => toEventItem(r.event, r.venue, null)) };
  }

  /**
   * Anúncios para a Home: eventos impulsionados (ou o próximo evento de um local impulsionado) que ainda não acabaram.
   * Não usa dados da pessoa para escolher: a lista só gira com o passar das horas. Quem bloqueou o anunciante, ou foi bloqueado por ele, não vê.
   */
  async sponsored(actorId: string): Promise<{ events: ExploreEventItem[] }> {
    const now = this.deps.clock.now();
    const active = await this.boosts.activeTargets(now);
    const ordered = [...active.boosts].sort((a, b) => (a.id < b.id ? -1 : 1));
    const shift = ordered.length === 0 ? 0 : Math.floor(now.getTime() / 3_600_000) % ordered.length;
    const rotated = [...ordered.slice(shift), ...ordered.slice(0, shift)];
    const out: ExploreEventItem[] = [];
    const seen = new Set<string>();
    for (const boost of rotated) {
      if (out.length >= EXPLORE_SPONSORED_LIMIT) break;
      if (await this.deps.blocks.existsEitherWay(actorId, boost.ownerId)) continue;
      let pick: { event: PlaceEventRecord; venue: VenueRecord } | undefined;
      if (boost.target === 'EVENT' && boost.eventId) {
        const found = await this.deps.places.findEvent(boost.eventId);
        if (found && found.event.endsAt.getTime() > now.getTime()) pick = found;
      } else if (boost.target === 'VENUE') {
        const venue = await this.deps.places.findVenue(boost.venueId);
        const next = (await this.deps.places.listVenueEvents(boost.venueId)).filter((e) => e.endsAt.getTime() > now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];
        if (venue && next) pick = { event: next, venue };
      }
      if (!pick || seen.has(pick.event.id)) continue;
      seen.add(pick.event.id);
      out.push({ ...toEventItem(pick.event, pick.venue, null), sponsored: true });
    }
    return { events: out };
  }

  /**
   * Explorar: sem texto devolve os eventos perto; com texto busca eventos, lugares, pessoas e hashtags (`#texto` só hashtags e eventos).
   * A posição vale só para esta consulta; nada é guardado.
   */
  async search(actorId: string, input: ExploreInput, opts: { withPeople?: boolean } = {}): Promise<ExploreView> {
    const withPeople = opts.withPeople !== false;
    const { places, clock } = this.deps;

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
    const offset = parseNumber(input.offset, 'offset') ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > EXPLORE_MAX_OFFSET) throw validationError('Posição da lista inválida', { offset: `Entre 0 e ${EXPLORE_MAX_OFFSET}` });

    const now = clock.now();
    const hot = parseBool(input.hot);
    // "Bombando" olha só o que está acontecendo agora: o período escolhido não vale.
    const from = hot ? now : (parseDate(input.from, 'from') ?? now);
    const to = hot ? new Date(now.getTime() + 1) : (parseDate(input.to, 'to') ?? new Date(from.getTime() + EXPLORE_DEFAULT_SPAN_DAYS * DAY_MS));
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
    // Sem texto, vale o raio escolhido (padrão 10 km). Busca por nome ou #tag procura em qualquer distância e vai trazendo mais conforme rola.
    const searching = rawQ !== '';
    const searchRadiusM = searching ? EXPLORE_SEARCH_RADIUS_M : radiusM;
    const base = { center, radiusM: center && !searching ? radiusM : undefined, from, to, kind, freeOnly, limit: EVENT_LIMIT + 1, offset };
    const slicePage = <T,>(rows: T[]): { rows: T[]; hasMore: boolean } => ({ rows: rows.slice(0, EVENT_LIMIT), hasMore: rows.length > EVENT_LIMIT });

    const toItems = async (rows: { event: PlaceEventRecord; venue: VenueRecord; distanceM: number | null }[]): Promise<ExploreEventItem[]> => {
      const items = rows.map((r) => toEventItem(r.event, r.venue, r.distanceM));
      if (!hot) {
        // Impulsionados sobem para o começo da lista (a ordem entre os demais não muda) e levam o selo “Patrocinado”.
        const active = await this.boosts.activeTargets(now);
        const marked = items.map((i) => (active.eventIds.has(i.id) || active.venueIds.has(i.venue.id) ? { ...i, sponsored: true } : i));
        return [...marked.filter((i) => i.sponsored), ...marked.filter((i) => !i.sponsored)];
      }
      const counts = await this.deps.eventRoom.countGoing(items.map((i) => ({ source: 'PLACE' as const, id: i.id })));
      return items
        .map((i) => ({ ...i, goingCount: counts.get(i.id) ?? 0 }))
        .filter((i) => i.goingCount >= EXPLORE_HOT_MIN_GOING)
        .sort((a, b) => b.goingCount - a.goingCount || (a.startsAt < b.startsAt ? -1 : 1));
    };

    const empty: ExploreView = {
      mode: rawQ === '' ? 'NEARBY' : isTag ? 'TAG' : 'SEARCH',
      q: rawQ,
      located: Boolean(center),
      radiusKm,
      from: from.toISOString(),
      to: to.toISOString(),
      events: [],
      hasMore: false,
      offset,
      places: [],
      people: [],
      tags: [],
      placesAvailable: true,
    };

    // Da segunda página em diante (offset > 0) vêm só mais eventos: lugares, pessoas e hashtags já estão na primeira.
    const first = offset === 0;

    if (rawQ === '') {
      const [found, people] = await Promise.all([places.searchEvents(base), hot || !first || !withPeople ? Promise.resolve([]) : this.peopleEvents(actorId, { center, radiusM, from, to, kind, freeOnly })]);
      const { rows, hasMore } = slicePage(found);
      return { ...empty, events: hot ? await toItems(rows) : mixByStart(await toItems(rows), people), hasMore: !hot && hasMore };
    }

    if (isTag) {
      const [found, tags] = await Promise.all([
        tag ? places.searchEvents({ ...base, tagPrefix: tag }) : Promise.resolve([]),
        first ? places.listTags(tag, from, to, TAG_LIMIT) : Promise.resolve([]),
      ]);
      const { rows, hasMore } = slicePage(found);
      return { ...empty, events: await toItems(rows), hasMore, tags };
    }

    // Texto livre: eventos, hashtags, lugares e pessoas, em qualquer distância.
    const foldedTag = normalizeTag(text);
    const [found, tags, venues, people] = await Promise.all([
      places.searchEvents({ ...base, text }),
      first && foldedTag ? places.listTags(foldedTag, from, to, TAG_LIMIT) : Promise.resolve([]),
      first ? places.searchVenues(text, center, searchRadiusM, VENUE_LIMIT) : Promise.resolve([]),
      first && withPeople && text.length >= 2 ? this.profiles.search(actorId, text, PEOPLE_LIMIT).catch(() => []) : Promise.resolve([]),
    ]);
    const page = slicePage(found);
    if (!first) return { ...empty, events: await toItems(page.rows), hasMore: page.hasMore };

    const { placeItems, placesAvailable } = await this.collectPlaces(actorId, venues, {
      center,
      radiusM: searchRadiusM,
      now,
      needle: !kind && !freeOnly && text.length >= 2 ? fold(text) : undefined,
      text,
      limit: VENUE_LIMIT,
    });

    const fromPeople = hot || !withPeople ? [] : await this.peopleEvents(actorId, { center, radiusM: searchRadiusM, from, to, kind, freeOnly, needle: fold(text) });
    return { ...empty, events: hot ? await toItems(page.rows) : mixByStart(await toItems(page.rows), fromPeople), hasMore: !hot && page.hasMore, places: placeItems, people, tags, placesAvailable };
  }

  /**
   * Eventos públicos criados por pessoas, para entrar na lista do Explorar junto com os dos locais.
   * Fora: evento privado ou arquivado, conta suspensa, bloqueio em qualquer sentido e perfil privado que quem consulta não segue.
   * Com posição, só os que têm local (rolê vinculado do AskouT) dentro do raio. "Grátis" não se aplica: eles não informam preço.
   */
  private async peopleEvents(
    actorId: string,
    opts: { center: { lat: number; lng: number } | undefined; radiusM: number; from: Date; to: Date; kind: EventKind | undefined; freeOnly: boolean; needle?: string },
  ): Promise<ExploreEventItem[]> {
    if (opts.freeOnly) return [];
    const { posts, places, users, blocks, follows } = this.deps;
    // Começou até 1 dia antes do período e ainda não acabou também vale (evento em andamento).
    const rows = await posts.listEventsStartingBetween(new Date(opts.from.getTime() - DAY_MS), opts.to, 200);
    const out: ExploreEventItem[] = [];
    for (const { post } of rows) {
      if (out.length >= PEOPLE_EVENT_LIMIT) break;
      if (post.eventTitle === null || !post.eventStartsAt || !post.eventEndsAt || post.eventPrivate || post.archivedAt !== null) continue;
      if (post.eventEndsAt.getTime() <= opts.from.getTime() || post.eventStartsAt.getTime() >= opts.to.getTime()) continue;
      if (opts.kind && post.eventKind !== opts.kind) continue;
      if (opts.needle && !fold(`${post.eventTitle} ${post.placeName ?? ''} ${post.caption ?? ''}`).includes(opts.needle)) continue;
      const venue = post.placeVenueId ? await places.findVenue(post.placeVenueId) : undefined;
      const distanceM = opts.center && venue ? distanceMeters(opts.center, { lat: venue.lat, lng: venue.lng }) : null;
      if (opts.center && (distanceM === null || distanceM > opts.radiusM)) continue;
      if (post.authorId !== actorId) {
        const account = await users.findById(post.authorId);
        if (!account || account.status !== 'ACTIVE') continue;
        if (await blocks.existsEitherWay(actorId, post.authorId)) continue;
      }
      const author = await users.findProfileById(post.authorId);
      if (!author) continue;
      if (author.isPrivate && post.authorId !== actorId && (await follows.get(actorId, post.authorId))?.status !== 'ACCEPTED') continue;
      out.push({
        id: post.id,
        title: post.eventTitle,
        description: post.caption,
        startsAt: post.eventStartsAt.toISOString(),
        endsAt: post.eventEndsAt.toISOString(),
        kind: post.eventKind,
        isFree: false,
        imageUrl: null,
        tags: [],
        sample: venue?.isSample ?? false,
        venue: venue
          ? { id: venue.id, name: venue.name, address: venue.address, category: venue.category, lat: venue.lat, lng: venue.lng, logoUrl: venue.logoUrl ?? null }
          : { id: '', name: post.placeName ?? '', address: post.placeAddress, category: null, lat: 0, lng: 0, logoUrl: null },
        distanceM: distanceM === null ? null : Math.round(distanceM),
        author: { userId: author.userId, username: author.username, displayName: author.displayName, avatarUrl: author.avatarUrl ?? null },
      });
    }
    return out;
  }

  /** Locais do AskouT já achados + de fora (Google/OSM) na mesma região, sem repetir, com os impulsionados primeiro. */
  private async collectPlaces(
    actorId: string,
    venues: { venue: VenueRecord; distanceM: number | null }[],
    opts: { center: { lat: number; lng: number } | undefined; radiusM: number; now: Date; needle?: string | undefined; text?: string; all?: boolean; limit: number },
  ): Promise<{ placeItems: ExplorePlaceItem[]; placesAvailable: boolean }> {
    const { places, placeSource } = this.deps;
    const { center, radiusM, now, needle } = opts;
    const profiles = await Promise.all(
      venues.map(async ({ venue }) => ({ id: venue.id, followerCount: await places.countVenueFollowers(venue.id), following: await places.isFollowingVenue(actorId, venue.id), rating: await places.venueRating(venue.id, actorId) })),
    );
    const profileById = new Map(profiles.map((p) => [p.id, p]));
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
      rating: ratingView(profileById.get(venue.id)!.rating).average,
      ratingCount: profileById.get(venue.id)!.rating.count || null,
      photoRef: venue.photoRef ?? null,
      photoAuthor: venue.photoAuthor ?? null,
      mapsUri: null,
      venue: { id: venue.id, logoUrl: venue.logoUrl ?? null, hours: venue.hours ?? null, followerCount: profileById.get(venue.id)?.followerCount ?? 0, following: profileById.get(venue.id)?.following ?? false, claimed: (venue.ownerId ?? null) !== null },
    }));

    {
      const active = await this.boosts.activeTargets(now);
      const marked = placeItems.map((p) => (p.venue && active.venueIds.has(p.venue.id) ? { ...p, sponsored: true } : p));
      placeItems.splice(0, placeItems.length, ...marked.filter((p) => p.sponsored), ...marked.filter((p) => !p.sponsored));
    }

    let placesAvailable = true;
    // Lugares de fora (Google/OSM) só quando há posição; na busca por texto, só os que combinam com o texto.
    if (center && (needle !== undefined || opts.all)) {
      const ext = await placeSource.nearby(center, Math.min(radiusM, EXPLORE_EXTERNAL_MAX_RADIUS_M), opts.all ? 80 : 60);
      placesAvailable = ext.available;
      const seen = new Set(placeItems.map((p) => fold(p.name)));
      const known = new Set(venues.flatMap(({ venue }) => (venue.externalKey ? [venue.externalKey] : [])));
      const extra = ext.places
        .filter((p) => needle === undefined || fold(p.name).includes(needle))
        .map((p) => ({ p, d: distanceMeters(center, { lat: p.lat, lng: p.lng }) }))
        .sort((a, b) => a.d - b.d);
      // A busca por perto só devolve os ~20 mais famosos da região: um bar pequeno nunca está entre eles, mesmo com raio grande.
      // Quando a pessoa digitou um nome, procura pelo nome (grátis primeiro; sem resultado, o Google, com teto diário).
      const typed = opts.text?.trim() ?? '';
      if (needle !== undefined && typed.length >= 3 && placeSource.search) {
        const matches = (list: ExternalPlace[]) => list.filter((p) => fold(p.name).includes(needle));
        let byName = await placeSource.search(typed, center, 10);
        let hits = matches(byName.places);
        if (hits.length === 0 && extra.length === 0 && placeSource.premiumSearch === true) {
          byName = await placeSource.search(typed, center, 10, { premium: true });
          hits = matches(byName.places);
        }
        placesAvailable = placesAvailable || byName.available;
        for (const p of hits) {
          if (!extra.some((e) => e.p.externalId === p.externalId && e.p.source === p.source)) extra.push({ p, d: distanceMeters(center, { lat: p.lat, lng: p.lng }) });
        }
        extra.sort((a, b) => a.d - b.d);
      }
      for (const { p, d } of extra) {
        if (placeItems.length >= opts.limit) break;
        const name = fold(p.name);
        if (seen.has(name) || known.has(`${p.source.toLowerCase()}:${p.externalId}`)) continue;
        seen.add(name);
        placeItems.push({
          key: `${p.source.toLowerCase()}:${p.externalId}`,
          source: p.source,
          name: p.name,
          category: p.category,
          address: p.address ?? null,
          lat: p.lat,
          lng: p.lng,
          sample: false,
          distanceM: Math.round(d),
          rating: p.rating ?? null,
          ratingCount: p.ratingCount ?? null,
          photoRef: p.photoRef ?? null,
          photoAuthor: p.photoAuthor ?? null,
          mapsUri: p.mapsUri ?? null,
          venue: null,
        });
      }
    }
    return { placeItems, placesAvailable };
  }

  /** Locais perto para o mapa do Explorar: os do AskouT e os de fora, sem filtro de texto. Exige posição. */
  async mapPlaces(actorId: string, input: ExploreInput): Promise<{ places: ExplorePlaceItem[]; placesAvailable: boolean }> {
    const lat = parseNumber(input.lat, 'lat');
    const lng = parseNumber(input.lng, 'lng');
    if (lat === undefined || lng === undefined) throw validationError('Posição necessária', { lat: 'Envie lat e lng' });
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw validationError('Posição inválida', { lat: 'Coordenadas fora do intervalo' });
    const radiusKm = parseNumber(input.radiusKm, 'radiusKm') ?? EXPLORE_DEFAULT_RADIUS_KM;
    if (radiusKm < 1 || radiusKm > EXPLORE_MAX_RADIUS_KM) throw validationError('Raio inválido', { radiusKm: `Entre 1 e ${EXPLORE_MAX_RADIUS_KM} km` });
    const center = { lat, lng };
    const radiusM = Math.round(radiusKm * 1000);
    const venues = await this.deps.places.searchVenues('', center, radiusM, MAP_PLACE_LIMIT);
    const { placeItems, placesAvailable } = await this.collectPlaces(actorId, venues, { center, radiusM, now: this.deps.clock.now(), all: true, limit: MAP_PLACE_LIMIT });
    return { places: placeItems, placesAvailable };
  }

  /**
   * Vincular um rolê: busca pelo nome ou endereço os locais do AskouT (em qualquer lugar) e, na fonte externa (Google),
   * qualquer lugar que combine, mesmo longe ou fora dos tipos de bar. Com posição, o que está perto vem primeiro.
   */
  async searchPlaces(actorId: string, input: { q?: unknown; lat?: unknown; lng?: unknown; google?: unknown }): Promise<{ places: ExplorePlaceItem[]; placesAvailable: boolean; canSearchGoogle: boolean }> {
    const text = typeof input.q === 'string' ? input.q.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (text.length < 2 || text.length > EXPLORE_QUERY_MAX || /[\u0000-\u001f\u007f]/.test(text)) throw validationError('Busca inválida', { q: `De 2 a ${EXPLORE_QUERY_MAX} caracteres` });
    const lat = parseNumber(input.lat, 'lat');
    const lng = parseNumber(input.lng, 'lng');
    if ((lat === undefined) !== (lng === undefined)) throw validationError('Posição incompleta', { lat: 'Envie lat e lng juntos' });
    if (lat !== undefined && lng !== undefined && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw validationError('Posição inválida', { lat: 'Coordenadas fora do intervalo' });
    const center = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

    const found = await this.deps.places.searchVenues(text, undefined, 0, VENUE_LIMIT);
    const venues = center
      ? found.map((v) => ({ ...v, distanceM: distanceMeters(center, v.venue) })).sort((a, b) => a.distanceM - b.distanceM)
      : found;
    const { placeItems } = await this.collectPlaces(actorId, venues, { center: undefined, radiusM: 0, now: this.deps.clock.now(), limit: VENUE_LIMIT });

    const source = this.deps.placeSource;
    // O Google cobra por busca: só entra quando a pessoa pede ("buscar no Google") e com pelo menos 3 letras.
    // Sem isso, a busca usa o AskouT e o OpenStreetMap, que são gratuitos.
    const premium = (input.google === true || input.google === 'true' || input.google === '1') && text.length >= GOOGLE_SEARCH_MIN_CHARS;
    const canSearchGoogle = source.premiumSearch === true && !premium && text.length >= GOOGLE_SEARCH_MIN_CHARS;
    if (!source.search) return { places: placeItems, placesAvailable: false, canSearchGoogle: false };
    let ext = await source.search(text, center, 10, { premium });
    // Sem nada no AskouT nem no OpenStreetMap, a pessoa cairia num beco sem saída (um bar pequeno quase nunca está no OSM):
    // o Google entra sozinho. Continua barrado pelo teto diário e pela memória de 10 minutos; com resultados, segue só no botão.
    let autoGoogle = false;
    if (!premium && source.premiumSearch === true && text.length >= GOOGLE_SEARCH_MIN_CHARS && placeItems.length === 0 && ext.places.length === 0) {
      ext = await source.search(text, center, 10, { premium: true });
      autoGoogle = ext.places.length > 0;
    }
    const seen = new Set(placeItems.map((p) => fold(p.name)));
    const known = new Set(venues.flatMap(({ venue }) => (venue.externalKey ? [venue.externalKey] : [])));
    for (const p of ext.places) {
      const key = `${p.source.toLowerCase()}:${p.externalId}`;
      const name = fold(p.name);
      if (known.has(key) || seen.has(name)) continue;
      seen.add(name);
      placeItems.push({
        key,
        source: p.source,
        name: p.name,
        category: p.category,
        address: p.address ?? null,
        lat: p.lat,
        lng: p.lng,
        sample: false,
        distanceM: center ? Math.round(distanceMeters(center, { lat: p.lat, lng: p.lng })) : null,
        rating: p.rating ?? null,
        ratingCount: p.ratingCount ?? null,
        photoRef: p.photoRef ?? null,
        photoAuthor: p.photoAuthor ?? null,
        mapsUri: p.mapsUri ?? null,
        venue: null,
      });
    }
    return { places: placeItems, placesAvailable: ext.available, canSearchGoogle: canSearchGoogle && !autoGoogle };
  }

  /** Um evento pelo id. Com posição, inclui a distância (usada só nesta resposta). */
  async event(actorId: string, id: unknown, input: { lat?: unknown; lng?: unknown } = {}): Promise<ExploreEventItem> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw notFound('Evento não encontrado');
    const lat = parseNumber(input.lat, 'lat');
    const lng = parseNumber(input.lng, 'lng');
    if ((lat === undefined) !== (lng === undefined)) throw validationError('Posição incompleta', { lat: 'Envie lat e lng juntos' });
    const found = await this.deps.places.findEvent(id);
    if (!found) throw notFound('Evento não encontrado');
    const distance = lat !== undefined && lng !== undefined ? distanceMeters({ lat, lng }, found.venue) : null;
    return { ...toEventItem(found.event, found.venue, distance), postedByMe: await this.deps.profileEvents.has(actorId, id) };
  }
}

/** Junta os eventos dos locais (patrocinados primeiro, como vieram) com os das pessoas: por dia, com bares, noite e baladas na frente. */
function mixByStart(placeItems: ExploreEventItem[], peopleItems: ExploreEventItem[]): ExploreEventItem[] {
  const sponsored = placeItems.filter((i) => i.sponsored);
  const rest = byDayAndNightlife([...placeItems.filter((i) => !i.sponsored), ...peopleItems]);
  return [...sponsored, ...rest];
}
