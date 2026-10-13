import type { CoreDeps } from './ports.ts';
import type { FlashService } from './flash-service.ts';
import { conflict } from './errors.ts';
import { distanceMeters, midpoint } from './geo.ts';

/** Raio em volta do ponto médio entre as duas pessoas. */
export const SUGGESTION_RADIUS_M = 3000;
/** Se estiverem mais longe que isto, "perto dos dois" deixa de fazer sentido. */
export const SUGGESTION_MAX_APART_M = 20_000;
/** Eventos em andamento ou que começam nas próximas horas. */
export const SUGGESTION_WINDOW_HOURS = 12;
export const SUGGESTION_MAX_ITEMS = 10;
/** Abaixo disso completamos com lugares do OpenStreetMap. */
export const SUGGESTION_MIN_EVENTS = 6;

export interface SuggestionItem {
  /** Identificador estável do cartão. */
  key: string;
  source: 'EVENT' | 'OSM' | 'GOOGLE';
  title: string;
  venueName: string;
  category: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  lat: number;
  lng: number;
  /** Nota e avaliações do Google, só quando a fonte é o Google. Vivem só na resposta, nunca no banco. */
  rating: number | null;
  ratingCount: number | null;
  /** Referência da foto na fonte; a API a transforma em endereço assinado. */
  photoRef: string | null;
  photoAuthor: string | null;
  /** Página do lugar na fonte (Google Maps), quando houver. */
  mapsUri: string | null;
  /** Distância do lugar até você, até a outra pessoa e até o ponto médio, em metros. */
  distanceFromMeM: number;
  distanceFromThemM: number;
  distanceFromMidM: number;
}

export interface SuggestionsView {
  /** TOO_FAR: estão distantes demais. NO_LOCATION não existe aqui: falta de posição vira erro 409. */
  reason: 'TOO_FAR' | null;
  radiusM: number;
  /** false quando a fonte externa de lugares (Google ou OpenStreetMap) não respondeu (a lista pode ter só eventos do AskouT). */
  placesAvailable: boolean;
  items: SuggestionItem[];
}

const round = (n: number) => Math.round(n);

export class SuggestionService {
  private readonly deps: CoreDeps;
  private readonly flash: FlashService;

  constructor(deps: CoreDeps, flash: FlashService) {
    this.deps = deps;
    this.flash = flash;
  }

  /** Lugares e eventos perto do ponto médio entre você e a pessoa do encontro. */
  async forMatch(actorId: string, inviteId: string): Promise<SuggestionsView> {
    const { places, placeSource, clock } = this.deps;
    const { me, them } = await this.flash.positionsForMatch(actorId, inviteId);
    if (!me || !them) throw conflict('Os dois precisam compartilhar a localização para ver sugestões');

    const mine = { lat: me.lat, lng: me.lng };
    const theirs = { lat: them.lat, lng: them.lng };
    const mid = midpoint(mine, theirs);
    if (distanceMeters(mine, theirs) > SUGGESTION_MAX_APART_M) {
      return { reason: 'TOO_FAR', radiusM: SUGGESTION_RADIUS_M, placesAvailable: true, items: [] };
    }

    const now = clock.now();
    const to = new Date(now.getTime() + SUGGESTION_WINDOW_HOURS * 3_600_000);
    const found = await places.findEventsNear(mid, SUGGESTION_RADIUS_M, now, to, SUGGESTION_MAX_ITEMS);

    const toItem = (item: Omit<SuggestionItem, 'distanceFromMeM' | 'distanceFromThemM' | 'distanceFromMidM' | 'rating' | 'ratingCount' | 'photoRef' | 'photoAuthor' | 'mapsUri'> & Partial<Pick<SuggestionItem, 'rating' | 'ratingCount' | 'photoRef' | 'photoAuthor' | 'mapsUri'>>): SuggestionItem => {
      const at = { lat: item.lat, lng: item.lng };
      return { rating: null, ratingCount: null, photoRef: null, photoAuthor: null, mapsUri: null, ...item, distanceFromMeM: round(distanceMeters(at, mine)), distanceFromThemM: round(distanceMeters(at, theirs)), distanceFromMidM: round(distanceMeters(at, mid)) };
    };

    const items: SuggestionItem[] = found.map(({ event, venue }) =>
      toItem({
        key: `event:${event.id}`,
        source: 'EVENT',
        title: event.title,
        venueName: venue.name,
        category: venue.category,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        sample: event.isSample || venue.isSample,
        lat: venue.lat,
        lng: venue.lng,
      }),
    );

    let placesAvailable = true;
    if (items.length < SUGGESTION_MIN_EVENTS) {
      const osm = await placeSource.nearby(mid, SUGGESTION_RADIUS_M, SUGGESTION_MAX_ITEMS * 2);
      placesAvailable = osm.available;
      const seen = new Set(items.map((i) => i.venueName.trim().toLowerCase()));
      const extra = osm.places
        .filter((p) => !seen.has(p.name.trim().toLowerCase()))
        .map((p) => ({ p, d: distanceMeters({ lat: p.lat, lng: p.lng }, mid) }))
        .filter(({ d }) => d <= SUGGESTION_RADIUS_M)
        .sort((a, b) => a.d - b.d);
      for (const { p } of extra) {
        if (items.length >= SUGGESTION_MAX_ITEMS) break;
        const name = p.name.trim().toLowerCase();
        if (seen.has(name)) continue;
        seen.add(name);
        items.push(
          toItem({
            key: `${p.source.toLowerCase()}:${p.externalId}`,
            source: p.source,
            title: p.name,
            venueName: p.name,
            category: p.category,
            startsAt: null,
            endsAt: null,
            sample: false,
            lat: p.lat,
            lng: p.lng,
            rating: p.rating ?? null,
            ratingCount: p.ratingCount ?? null,
            photoRef: p.photoRef ?? null,
            photoAuthor: p.photoAuthor ?? null,
            mapsUri: p.mapsUri ?? null,
          }),
        );
      }
    }
    return { reason: null, radiusM: SUGGESTION_RADIUS_M, placesAvailable, items };
  }
}
