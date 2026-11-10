import type { GifItem, GifPage, GifSource } from '../../core/ports.ts';

const GIF_HOST = /^(?:media\d*|i)\.giphy\.com$/;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 60_000;

export interface GiphyOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

interface GiphyImage {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

/**
 * GIFs pela API da Giphy. A chamada sai do servidor: a chave nunca vai para o navegador e a Giphy não vê quem pergunta.
 * Só passam GIFs com endereço https de servidor da Giphy e classificação "g" (livre para todos).
 * Nunca lança: qualquer falha vira página vazia.
 */
export class GiphyGifSource implements GifSource {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; value: GifPage }>();

  constructor(options: GiphyOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.giphy.com/v1/gifs').replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.now = options.now ?? Date.now;
  }

  trending(query: { limit: number; offset: number; lang: string }): Promise<GifPage> {
    return this.get('trending', { limit: query.limit, offset: query.offset });
  }

  search(q: string, query: { limit: number; offset: number; lang: string }): Promise<GifPage> {
    return this.get('search', { q, limit: query.limit, offset: query.offset, lang: query.lang });
  }

  private async get(path: 'trending' | 'search', params: Record<string, string | number>): Promise<GifPage> {
    const search = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), rating: 'g' });
    const cacheKey = `${path}?${search.toString()}`;
    const hit = this.cache.get(cacheKey);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const empty: GifPage = { items: [], nextOffset: null };
    try {
      search.set('api_key', this.apiKey);
      const res = await this.fetchFn(`${this.baseUrl}/${path}?${search.toString()}`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) return empty;
      const body = (await res.json()) as { data?: unknown; pagination?: { total_count?: unknown; count?: unknown; offset?: unknown } };
      const items = Array.isArray(body.data) ? body.data.flatMap((d) => GiphyGifSource.item(d)) : [];
      const offset = Number(params['offset']);
      const total = Number(body.pagination?.total_count);
      const next = offset + Number(params['limit']);
      const value: GifPage = { items, nextOffset: items.length > 0 && Number.isFinite(total) && next < total ? next : null };
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(cacheKey, { at: this.now(), value });
      return value;
    } catch {
      return empty;
    }
  }

  private static item(raw: unknown): GifItem[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const d = raw as { id?: unknown; title?: unknown; images?: Record<string, GiphyImage | undefined> };
    const img = d.images?.['fixed_width'];
    if (typeof d.id !== 'string' || !/^[A-Za-z0-9]{5,40}$/.test(d.id) || !img || typeof img.url !== 'string') return [];
    try {
      const url = new URL(img.url);
      if (url.protocol !== 'https:' || !GIF_HOST.test(url.hostname)) return [];
      const width = Number(img.width);
      const height = Number(img.height);
      return [{ id: d.id, title: typeof d.title === 'string' ? d.title.slice(0, 120) : '', url: url.toString(), width: Number.isFinite(width) && width > 0 ? width : 200, height: Number.isFinite(height) && height > 0 ? height : 200 }];
    } catch {
      return [];
    }
  }
}
