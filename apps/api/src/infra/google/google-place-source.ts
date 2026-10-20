import type { PlaceSource } from '../../core/ports.ts';
import type { ExternalPlace } from '../../core/types.ts';

const ENDPOINT = 'https://places.googleapis.com/v1';
const FIELDS = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.primaryType,places.googleMapsUri,places.photos';
/** Só aceita referências de foto no formato do Google (evita usar o servidor como proxy aberto). */
export const PHOTO_REF_RE = /^places\/[A-Za-z0-9_-]{1,200}\/photos\/[A-Za-z0-9_-]{1,600}$/;

export interface GoogleOptions {
  apiKey: string;
  /** Teto de buscas por dia (UTC) para a conta não passar do crédito gratuito sem você saber. */
  dailyLimit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  googleMapsUri?: string;
  photos?: { name?: string; authorAttributions?: { displayName?: string }[] }[];
}

/**
 * Google Places (API nova): bares, cafés e restaurantes perto de um ponto, com nota, avaliações e foto.
 * Regras dos termos do Google que este código respeita: os dados ficam só na memória da requisição (não há cache nem banco),
 * a foto é buscada pelo servidor (a chave nunca vai ao app) e quem usa deve mostrar o crédito ao Google.
 * Nunca lança: qualquer falha vira `available: false`.
 */
export class GooglePlaceSource implements PlaceSource {
  private readonly apiKey: string;
  private readonly dailyLimit: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private day = '';
  private used = 0;

  constructor(options: GoogleOptions) {
    this.apiKey = options.apiKey;
    this.dailyLimit = options.dailyLimit ?? 500;
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private spend(): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.dailyLimit) return false;
    this.used += 1;
    return true;
  }

  async nearby(center: { lat: number; lng: number }, radiusM: number, limit: number): Promise<{ available: boolean; places: ExternalPlace[] }> {
    if (!this.spend()) return { available: false, places: [] };
    try {
      const response = await this.fetchImpl(`${ENDPOINT}/places:searchNearby`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey, 'x-goog-fieldmask': FIELDS },
        body: JSON.stringify({
          includedTypes: ['bar', 'night_club', 'restaurant', 'cafe'],
          maxResultCount: Math.max(1, Math.min(limit, 20)),
          rankPreference: 'POPULARITY',
          languageCode: 'pt-BR',
          locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50_000, Math.max(1, radiusM)) } },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return { available: false, places: [] };
      const json = (await response.json()) as { places?: GooglePlace[] };
      return { available: true, places: parse(json.places) };
    } catch {
      return { available: false, places: [] };
    }
  }

  /** Baixa a foto no servidor. Devolve undefined se a referência for inválida ou o Google não entregar. */
  async photo(ref: string): Promise<{ type: string; bytes: Uint8Array } | undefined> {
    if (!PHOTO_REF_RE.test(ref)) return undefined;
    try {
      const response = await this.fetchImpl(`${ENDPOINT}/${ref}/media?maxWidthPx=640&maxHeightPx=400&key=${encodeURIComponent(this.apiKey)}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'follow',
      });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('image/')) return undefined;
      return { type, bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch {
      return undefined;
    }
  }
}

function parse(places: GooglePlace[] | undefined): ExternalPlace[] {
  if (!Array.isArray(places)) return [];
  const out: ExternalPlace[] = [];
  for (const p of places) {
    const name = p.displayName?.text?.trim();
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (!p.id || !name || name.length > 120 || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const photo = p.photos?.find((x) => typeof x.name === 'string' && PHOTO_REF_RE.test(x.name));
    out.push({
      externalId: p.id,
      source: 'GOOGLE',
      name,
      category: p.primaryType ?? null,
      lat,
      lng,
      rating: typeof p.rating === 'number' && p.rating >= 0 && p.rating <= 5 ? p.rating : null,
      ratingCount: typeof p.userRatingCount === 'number' && p.userRatingCount >= 0 ? Math.round(p.userRatingCount) : null,
      photoRef: photo?.name ?? null,
      photoAuthor: photo?.authorAttributions?.[0]?.displayName?.slice(0, 80) ?? null,
      mapsUri: typeof p.googleMapsUri === 'string' && p.googleMapsUri.startsWith('https://') ? p.googleMapsUri : null,
    });
  }
  return out;
}
