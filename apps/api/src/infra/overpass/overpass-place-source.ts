import type { PlaceSource } from '../../core/ports.ts';
import type { ExternalPlace } from '../../core/types.ts';

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

export interface OverpassOptions {
  endpoint?: string;
  /** Identifica o app para os operadores do serviço (política de uso do Overpass). */
  contact?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
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
  private readonly contact: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; places: ExternalPlace[] }>();

  constructor(options: OverpassOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
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
      const query = `[out:json][timeout:6];nwr(around:${Math.round(radiusM)},${lat},${lng})[amenity~"^(bar|pub|cafe|restaurant|biergarten)$"][name];out center ${Math.max(1, Math.min(limit, 60))};`;
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
    out.push({ externalId, name, category: el.tags?.amenity ?? null, lat, lng });
  }
  return out;
}
