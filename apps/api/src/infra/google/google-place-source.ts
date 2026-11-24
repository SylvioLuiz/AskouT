import type { PlaceSource } from '../../core/ports.ts';
import type { ExternalPlace } from '../../core/types.ts';

const ENDPOINT = 'https://places.googleapis.com/v1';
/**
 * Só campos da faixa "Pro" do Google (5.000 chamadas grátis por mês em cada tipo de busca). Nota (`rating`) e número de
 * avaliações (`userRatingCount`) jogam a chamada inteira para a faixa "Enterprise" (só 1.000 grátis e bem mais cara),
 * por isso ficam de fora.
 */
const FIELDS = 'places.id,places.displayName,places.location,places.primaryType,places.googleMapsUri,places.photos';
/** Busca por texto e detalhe de um lugar também trazem o endereço, que vira o endereço do rolê vinculado. */
const SEARCH_FIELDS = `${FIELDS},places.formattedAddress`;
const DETAIL_FIELDS = 'id,displayName,location,primaryType,googleMapsUri,photos,formattedAddress';

/** Tipos de chamada, cada um com a sua franquia gratuita mensal no Google e o seu teto diário aqui. */
export type GoogleCallKind = 'nearby' | 'search' | 'lookup' | 'photo';

/**
 * Tetos diários padrão, abaixo da franquia gratuita mensal dividida por 31 dias: busca por perto, por texto e detalhe
 * (faixa Pro, 5.000/mês) e fotos (1.000/mês). O console do Google tem cotas iguais como trava de verdade.
 */
/** Buscas iguais dentro de 10 minutos reaproveitam a resposta, sem chamar (nem pagar) o Google de novo. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 300;
/** Fotos (640x400, poucas dezenas de KB cada): guardadas por 1 hora, no máximo 150. */
const PHOTO_TTL_MS = 60 * 60_000;
const PHOTO_CACHE_MAX = 150;

export const GOOGLE_DAILY_DEFAULTS: Record<GoogleCallKind, number> = { nearby: 150, search: 150, lookup: 150, photo: 30 };
/** Id de lugar do Google: só letras, números, `_` e `-` (o servidor monta a URL com ele). */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;
/** Só aceita referências de foto no formato do Google (evita usar o servidor como proxy aberto). */
export const PHOTO_REF_RE = /^places\/[A-Za-z0-9_-]{1,200}\/photos\/[A-Za-z0-9_-]{1,600}$/;

export interface GoogleOptions {
  apiKey: string;
  /** Teto geral por dia (UTC) para cada tipo de chamada; vale o menor entre ele e o teto do tipo. */
  dailyLimit?: number;
  /** Teto por dia (UTC) de cada tipo de chamada, para a conta não passar da franquia gratuita. */
  dailyLimits?: Partial<Record<GoogleCallKind, number>>;
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
  formattedAddress?: string;
  photos?: { name?: string; authorAttributions?: { displayName?: string }[] }[];
}

/**
 * Google Places (API nova): bares, cafés e restaurantes perto de um ponto, com foto.
 * Os resultados das buscas ficam até 10 minutos na memória do servidor (escolha da dona do app para não pagar duas vezes
 * pela mesma busca); nada vai para o banco além do que a pessoa escolhe vincular,
 * a foto é buscada pelo servidor (a chave nunca vai ao app) e quem usa deve mostrar o crédito ao Google.
 * Nunca lança: qualquer falha vira `available: false`.
 */
export class GooglePlaceSource implements PlaceSource {
  private readonly apiKey: string;
  private readonly limits: Record<GoogleCallKind, number>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private day = '';
  private used: Record<GoogleCallKind, number> = { nearby: 0, search: 0, lookup: 0, photo: 0 };
  private readonly cache = new Map<string, { at: number; places: ExternalPlace[] }>();
  /** A busca por texto só existe no Google, e ele cobra: o app só usa quando a pessoa pede. */
  readonly premiumSearch = true;

  constructor(options: GoogleOptions) {
    this.apiKey = options.apiKey;
    const cap = options.dailyLimit ?? Number.POSITIVE_INFINITY;
    const limits = { ...GOOGLE_DAILY_DEFAULTS, ...options.dailyLimits };
    this.limits = {
      nearby: Math.min(cap, limits.nearby),
      search: Math.min(cap, limits.search),
      lookup: Math.min(cap, limits.lookup),
      photo: Math.min(cap, limits.photo),
    };
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private cached(key: string): ExternalPlace[] | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.places.map((p) => ({ ...p }));
  }

  private remember(key: string, places: ExternalPlace[]): void {
    this.cache.delete(key);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: this.now(), places });
  }

  private readonly warned = new Set<string>();
  /** Registra no log do servidor por que o Google não respondeu (a chave nunca entra na mensagem); uma vez por motivo. */
  private warn(message: string, once: string): void {
    if (this.warned.has(once)) return;
    if (this.warned.size > 200) this.warned.clear();
    this.warned.add(once);
    console.warn(`[google] ${message}`);
  }

  private async fail(kind: GoogleCallKind, response: Response): Promise<void> {
    let detail = '';
    try { detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240); } catch { /* sem corpo */ }
    this.warn(`${kind}: HTTP ${response.status} ${detail}`, `http:${kind}:${response.status}`);
  }

  private spend(kind: GoogleCallKind): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = { nearby: 0, search: 0, lookup: 0, photo: 0 };
    }
    if (this.used[kind] >= this.limits[kind]) {
      this.warn(`teto diário de ${kind} atingido (${this.limits[kind]})`, `cap:${kind}:${today}`);
      return false;
    }
    this.used[kind] += 1;
    return true;
  }

  async nearby(center: { lat: number; lng: number }, radiusM: number, limit: number): Promise<{ available: boolean; places: ExternalPlace[] }> {
    // Arredondar a ~110 m deixa pedidos vizinhos compartilharem a mesma resposta guardada.
    const lat = Math.round(center.lat * 1000) / 1000;
    const lng = Math.round(center.lng * 1000) / 1000;
    const count = Math.max(1, Math.min(limit, 20));
    const key = `nearby|${lat},${lng}|${Math.round(radiusM)}|${count}`;
    const hit = this.cached(key);
    if (hit) return { available: true, places: hit };
    if (!this.spend('nearby')) return { available: false, places: [] };
    try {
      const response = await this.fetchImpl(`${ENDPOINT}/places:searchNearby`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey, 'x-goog-fieldmask': FIELDS },
        body: JSON.stringify({
          includedTypes: ['bar', 'night_club', 'restaurant', 'cafe'],
          maxResultCount: count,
          rankPreference: 'POPULARITY',
          languageCode: 'pt-BR',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(50_000, Math.max(1, radiusM)) } },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        await this.fail('nearby', response);
        return { available: false, places: [] };
      }
      const json = (await response.json()) as { places?: GooglePlace[] };
      const places = parse(json.places);
      this.remember(key, places);
      return { available: true, places: places.map((p) => ({ ...p })) };
    } catch (e) {
      this.warn(`nearby: ${e instanceof Error ? e.message : 'falha'}`, 'ex:nearby');
      return { available: false, places: [] };
    }
  }

  /**
   * Qualquer lugar pelo nome ou endereço (não só bares perto): é o que a pessoa digita ao vincular um rolê que ainda não
   * está no AskouT. Com `center`, os resultados perto dele vêm primeiro.
   */
  async search(text: string, center: { lat: number; lng: number } | undefined, limit: number, _opts?: { premium?: boolean }): Promise<{ available: boolean; places: ExternalPlace[] }> {
    const at = center ? `${Math.round(center.lat * 100) / 100},${Math.round(center.lng * 100) / 100}` : '-';
    const size = Math.max(1, Math.min(limit, 20));
    const key = `search|${text.trim().toLowerCase().replace(/\s+/g, ' ')}|${at}|${size}`;
    const hit = this.cached(key);
    if (hit) return { available: true, places: hit };
    if (!this.spend('search')) return { available: false, places: [] };
    try {
      const response = await this.fetchImpl(`${ENDPOINT}/places:searchText`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey, 'x-goog-fieldmask': SEARCH_FIELDS },
        body: JSON.stringify({
          textQuery: text,
          pageSize: size,
          languageCode: 'pt-BR',
          regionCode: 'BR',
          // A posição só ordena os resultados; arredondada a ~1 km, vizinhos reaproveitam a mesma busca guardada.
          ...(center ? { locationBias: { circle: { center: { latitude: Math.round(center.lat * 100) / 100, longitude: Math.round(center.lng * 100) / 100 }, radius: 50_000 } } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        await this.fail('search', response);
        return { available: false, places: [] };
      }
      const json = (await response.json()) as { places?: GooglePlace[] };
      const places = parse(json.places);
      this.remember(key, places);
      return { available: true, places: places.map((p) => ({ ...p })) };
    } catch (e) {
      this.warn(`search: ${e instanceof Error ? e.message : 'falha'}`, 'ex:search');
      return { available: false, places: [] };
    }
  }

  /** Um lugar pelo id do Google, para confirmar que existe antes de criar o local no AskouT. */
  async lookup(externalId: string): Promise<ExternalPlace | undefined> {
    if (!PLACE_ID_RE.test(externalId) || !this.spend('lookup')) return undefined;
    try {
      const response = await this.fetchImpl(`${ENDPOINT}/places/${externalId}?languageCode=pt-BR`, {
        headers: { 'x-goog-api-key': this.apiKey, 'x-goog-fieldmask': DETAIL_FIELDS },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        await this.fail('lookup', response);
        return undefined;
      }
      return parse([(await response.json()) as GooglePlace])[0];
    } catch {
      return undefined;
    }
  }

  /** Baixa a foto no servidor. Devolve undefined se a referência for inválida ou o Google não entregar. */
  async photo(ref: string): Promise<{ type: string; bytes: Uint8Array } | undefined> {
    if (!PHOTO_REF_RE.test(ref)) return undefined;
    // Cada foto custa uma chamada da franquia (30 por dia): o mapa abre muitas de uma vez, então a mesma foto é buscada
    // no Google uma vez só por hora (e pedidos simultâneos dividem a mesma busca).
    const hit = this.photos.get(ref);
    if (hit && this.now() - hit.at < PHOTO_TTL_MS) return hit.value;
    const pending = this.photoPending.get(ref);
    if (pending) return pending;
    const run = this.fetchPhoto(ref).then((value) => {
      if (value) {
        this.photos.delete(ref);
        if (this.photos.size >= PHOTO_CACHE_MAX) this.photos.delete(this.photos.keys().next().value as string);
        this.photos.set(ref, { at: this.now(), value });
      }
      return value;
    }).finally(() => this.photoPending.delete(ref));
    this.photoPending.set(ref, run);
    return run;
  }

  private readonly photos = new Map<string, { at: number; value: { type: string; bytes: Uint8Array } }>();
  private readonly photoPending = new Map<string, Promise<{ type: string; bytes: Uint8Array } | undefined>>();

  private async fetchPhoto(ref: string): Promise<{ type: string; bytes: Uint8Array } | undefined> {
    if (!this.spend('photo')) return undefined;
    try {
      const response = await this.fetchImpl(`${ENDPOINT}/${ref}/media?maxWidthPx=640&maxHeightPx=400&key=${encodeURIComponent(this.apiKey)}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'follow',
      });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('image/')) {
        if (!response.ok) await this.fail('photo', response);
        return undefined;
      }
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
      address: typeof p.formattedAddress === 'string' && p.formattedAddress.trim() !== '' ? p.formattedAddress.trim().slice(0, 200) : null,
    });
  }
  return out;
}
