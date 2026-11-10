import { validationError } from './errors.ts';
import type { CoreDeps, GifPage } from './ports.ts';

/** GIF anexado a um comentário: só o id e o endereço (em servidor da Giphy) são guardados. */
export interface CommentGif {
  id: string;
  url: string;
}

export const GIF_URL_MAX = 500;
export const GIF_PAGE_DEFAULT = 24;
export const GIF_PAGE_MAX = 30;
export const GIF_QUERY_MAX = 50;
export const GIF_OFFSET_MAX = 500;
const GIF_ID = /^[A-Za-z0-9]{5,40}$/;
/** media.giphy.com, media0…media9 (e mais) e i.giphy.com: os servidores de mídia da Giphy. */
const GIF_HOST = /^(?:media\d*|i)\.giphy\.com$/;

/**
 * Valida o anexo `{ id, url }` de um comentário. Sem anexo (`undefined`/`null`) devolve `null`.
 * Só entra endereço https de servidor da Giphy: o app mostra essa URL direto, então nada de outro host.
 */
export function parseCommentGif(raw: unknown): CommentGif | null {
  if (raw === undefined || raw === null) return null;
  const bad = () => validationError('GIF inválido', { gif: 'Escolha um GIF da lista' });
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  const { id, url } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !GIF_ID.test(id)) throw bad();
  if (typeof url !== 'string' || url.length > GIF_URL_MAX) throw bad();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw bad();
  }
  if (parsed.protocol !== 'https:' || !GIF_HOST.test(parsed.hostname) || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') throw bad();
  return { id, url: parsed.toString() };
}

/** O GIF de um registro de comentário, ou `null` se não tem. */
export function gifOf(row: { gifId?: string | null; gifUrl?: string | null }): CommentGif | null {
  return row.gifId && row.gifUrl ? { id: row.gifId, url: row.gifUrl } : null;
}

/** O texto que a gestão e as denúncias guardam de um comentário: o texto e, se houver, o endereço do GIF. */
export function commentEvidence(body: string, gifUrl: string | null | undefined, max = 600): string {
  const text = body.trim();
  if (!gifUrl) return text.slice(0, max);
  return `${text ? `${text.slice(0, Math.max(0, max - gifUrl.length - 8))} ` : ''}[GIF] ${gifUrl}`;
}

export interface GifSearchView {
  items: GifPage['items'];
  nextOffset: number | null;
}

/** Busca de GIFs. Sem a chave da Giphy (`deps.gifs` ausente) o recurso fica desligado. */
export class GifService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  get enabled(): boolean {
    return this.deps.gifs !== undefined;
  }

  private page(query: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
    const limit = Number(query.limit ?? GIF_PAGE_DEFAULT);
    const offset = Number(query.offset ?? 0);
    return {
      limit: Number.isInteger(limit) ? Math.min(Math.max(limit, 1), GIF_PAGE_MAX) : GIF_PAGE_DEFAULT,
      offset: Number.isInteger(offset) ? Math.min(Math.max(offset, 0), GIF_OFFSET_MAX) : 0,
    };
  }

  private lang(raw: unknown): string {
    return raw === 'en' || raw === 'es' || raw === 'pt' ? raw : 'pt';
  }

  /** Mais populares do momento (campo de busca vazio). */
  async trending(query: { limit?: unknown; offset?: unknown; lang?: unknown } = {}): Promise<GifSearchView & { enabled: boolean }> {
    const source = this.deps.gifs;
    if (!source) return { enabled: false, items: [], nextOffset: null };
    const page = await source.trending({ ...this.page(query), lang: this.lang(query.lang) });
    return { enabled: true, items: page.items, nextOffset: page.nextOffset };
  }

  async search(query: { q?: unknown; limit?: unknown; offset?: unknown; lang?: unknown }): Promise<GifSearchView & { enabled: boolean }> {
    const source = this.deps.gifs;
    if (!source) return { enabled: false, items: [], nextOffset: null };
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, GIF_QUERY_MAX) : '';
    if (!q) return this.trending(query);
    const page = await source.search(q, { ...this.page(query), lang: this.lang(query.lang) });
    return { enabled: true, items: page.items, nextOffset: page.nextOffset };
  }
}
