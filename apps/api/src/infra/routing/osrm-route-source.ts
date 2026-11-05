import type { RouteResult, RouteSource } from '../../core/ports.ts';

const PROFILE = { foot: 'foot', driving: 'driving' } as const;
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60_000;

export interface OsrmOptions {
  /** Servidor OSRM. O público (router.project-osrm.org) é para uso leve; para muito tráfego, use o seu. */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/** Mantém no máximo `max` pontos, sempre com o primeiro e o último. */
export function simplifyLine(line: [number, number][], max = 150): [number, number][] {
  if (line.length <= max) return line;
  const out: [number, number][] = [];
  const step = (line.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(line[Math.round(i * step)]!);
  return out;
}

/**
 * Rotas pelo OSRM (dados do OpenStreetMap). A chamada sai do servidor: o aparelho de quem usa nunca fala com o OSRM,
 * e o OSRM só recebe duas coordenadas, sem identificar ninguém. Nunca lança: qualquer falha vira `undefined`.
 */
export class OsrmRouteSource implements RouteSource {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; value: RouteResult | undefined }>();

  constructor(options: OsrmOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://router.project-osrm.org').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.now = options.now ?? Date.now;
  }

  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'foot' | 'driving'): Promise<RouteResult | undefined> {
    // Chave arredondada (~10 m): quem está parado reaproveita a mesma resposta por um minuto.
    const r = (n: number) => n.toFixed(4);
    const key = `${mode}:${r(from.lat)},${r(from.lng)}>${r(to.lat)},${r(to.lng)}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.fetchRoute(from, to, mode);
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  private async fetchRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'foot' | 'driving'): Promise<RouteResult | undefined> {
    try {
      const url = `${this.baseUrl}/route/v1/${PROFILE[mode]}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json' } });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { code?: string; routes?: { distance?: number; duration?: number; geometry?: { coordinates?: unknown } }[] };
      const route = body.code === 'Ok' ? body.routes?.[0] : undefined;
      const coords = route?.geometry?.coordinates;
      if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number' || !Array.isArray(coords)) return undefined;
      const line = coords.filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number');
      if (line.length < 2) return undefined;
      return { distanceM: route.distance, durationS: route.duration, line: simplifyLine(line) };
    } catch {
      return undefined;
    }
  }
}
