import type { PlaceSource } from '../../core/ports.ts';
import type { ExternalPlace } from '../../core/types.ts';

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
/** Photon: busca por nome ou endereço sobre o OpenStreetMap, gratuita e feita para buscar enquanto se digita. */
const DEFAULT_SEARCH_ENDPOINT = 'https://photon.komoot.io/api/';
/** Sem posição, a busca fica no Brasil (oeste, sul, leste, norte). */
const BRAZIL_BBOX = '-74,-34,-34,6';
const OSM_ID_RE = /^(node|way|relation)\/(\d{1,15})$/;
const PHOTON_TYPES: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

export interface OverpassOptions {
  endpoint?: string;
  /** Endereço da busca por texto (Photon). */
  searchEndpoint?: string;
  /** Identifica o app para os operadores do serviço (política de uso do Overpass). */
  contact?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; type?: string; name?: string; street?: string; housenumber?: string; district?: string; city?: string; state?: string };
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/**
 * Lugares (bares, cafés, restaurantes) do OpenStreetMap via Overpass. Dados © contribuidores do OpenStreetMap.
 * Nunca lança: qualquer falha vira `available: false` e o app segue só com os eventos do AskouT.
 * O servidor público é para desenvolvimento; em produção, usar instância própria ou um provedor contratado.
 */
export class OverpassPlaceSource implements PlaceSource {
  private readonly endpoint: string;
  private readonly searchEndpoint: string;
  private readonly contact: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; places: ExternalPlace[] }>();

  constructor(options: OverpassOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.searchEndpoint = options.searchEndpoint ?? DEFAULT_SEARCH_ENDPOINT;
    this.contact = options.contact ?? 'sem-contato-configurado';
    this.timeoutMs = options.timeoutMs ?? 6000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async nearby(center: { lat: number; lng: number }, radiusM: number, limit: number): Promise<{ available: boolean; places: ExternalPlace[] }> {
    // Arredondar a ~110 m deixa vários pedidos próximos compartilharem o cache e não expõe o ponto exato ao serviço externo.
    const lat = Math.round(center.lat * 1000) / 1000;
    const lng = Math.round(center.lng * 1000) / 1000;
    const key = `${lat},${lng},${radiusM}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return { available: true, places: hit.places.slice(0, limit) };

    try {
      const query = `[out:json][timeout:6];nwr(around:${Math.round(radiusM)},${lat},${lng})[amenity~"^(bar|pub|nightclub|cafe|restaurant|biergarten)$"][name];out center ${Math.max(1, Math.min(limit, 60))};`;
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': `AskouT/0.1 (${this.contact})` },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return { available: false, places: [] };
      const json = (await response.json()) as { elements?: OverpassElement[] };
      const places = parse(json.elements);
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, { at: this.now(), places });
      return { available: true, places: places.slice(0, limit) };
    } catch {
      return { available: false, places: [] };
    }
  }

  private get userAgent(): string {
    return `AskouT/0.1 (${this.contact})`;
  }

  /** Qualquer lugar pelo nome ou endereço (Photon, dados do OpenStreetMap). Gratuito; resultados guardados 10 minutos. */
  async search(text: string, center: { lat: number; lng: number } | undefined, limit: number): Promise<{ available: boolean; places: ExternalPlace[] }> {
    const q = text.trim().replace(/\s+/g, ' ');
    const size = Math.max(1, Math.min(limit, 20));
    const params = new URLSearchParams({ q, limit: String(size) });
    if (center) {
      params.set('lat', String(Math.round(center.lat * 100) / 100));
      params.set('lon', String(Math.round(center.lng * 100) / 100));
    } else {
      params.set('bbox', BRAZIL_BBOX);
    }
    const key = `search|${params.toString().toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return { available: true, places: hit.places.map((p) => ({ ...p })) };
    try {
      const response = await this.fetchImpl(`${this.searchEndpoint}?${params.toString()}`, {
        headers: { 'user-agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return { available: false, places: [] };
      const json = (await response.json()) as { features?: PhotonFeature[] };
      const places = parsePhoton(json.features).slice(0, size);
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, { at: this.now(), places });
      return { available: true, places: places.map((p) => ({ ...p })) };
    } catch {
      return { available: false, places: [] };
    }
  }

  /** Um lugar do OpenStreetMap pelo id (`node/123`, `way/45`...), para confirmar que existe antes de criar o local. */
  async lookup(externalId: string): Promise<ExternalPlace | undefined> {
    const match = OSM_ID_RE.exec(externalId);
    if (!match) return undefined;
    try {
      const query = `[out:json][timeout:6];${match[1]}(${match[2]});out center tags;`;
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': this.userAgent },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return undefined;
      const json = (await response.json()) as { elements?: OverpassElement[] };
      return parse(json.elements).find((p) => p.externalId === externalId);
    } catch {
      return undefined;
    }
  }
}

function parse(elements: OverpassElement[] | undefined): ExternalPlace[] {
  if (!Array.isArray(elements)) return [];
  const out: ExternalPlace[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const name = el.tags?.name?.trim();
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || name.length > 120 || typeof el.id !== 'number' || typeof el.type !== 'string') continue;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const externalId = `${el.type}/${el.id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const tags = el.tags ?? {};
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
    const address = [street, tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(' - ').slice(0, 200);
    const isStreet = typeof tags.highway === 'string' && !tags.amenity && !tags.leisure && !tags.tourism;
    out.push({ externalId, source: 'OSM', name, category: tags.amenity ?? tags.leisure ?? tags.tourism ?? null, lat, lng, ...(address ? { address } : {}), ...(isStreet ? { street: true } : {}) });
  }
  return out;
}

function parsePhoton(features: PhotonFeature[] | undefined): ExternalPlace[] {
  if (!Array.isArray(features)) return [];
  const out: ExternalPlace[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = f.properties ?? {};
    // Endereço com número (casa, prédio) costuma vir sem nome no OpenStreetMap: vira "Rua X, 123".
    const name = p.name?.trim() || (p.street?.trim() && p.housenumber?.trim() ? `${p.street.trim()}, ${p.housenumber.trim()}` : undefined);
    const type = p.osm_type ? PHOTON_TYPES[p.osm_type] : undefined;
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!name || name.length > 120 || !type || typeof p.osm_id !== 'number' || !Number.isInteger(p.osm_id) || p.osm_id <= 0) continue;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const externalId = `${type}/${p.osm_id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const street = [p.street, p.housenumber].filter(Boolean).join(', ');
    const address = [street, p.district, p.city, p.state].filter(Boolean).join(' - ').slice(0, 200);
    const isStreet = p.osm_key === 'highway' || p.type === 'street';
    out.push({ externalId, source: 'OSM', name, category: p.osm_value ?? null, lat, lng, address: address || null, ...(isStreet ? { street: true } : {}) });
  }
  return out;
}
