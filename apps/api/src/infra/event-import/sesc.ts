import type { ImportedEvent } from './niche.ts';

/**
 * Programação do Sesc São Paulo (https://www.sescsp.org.br/programacao/). O site não tem API de eventos: cada atividade
 * tem uma página pública (listada no sitemap, com data de atualização) com unidade, categoria, preço, local e datas.
 * Lemos as páginas atualizadas há pouco, só as presenciais, e só as que ainda vão acontecer (mês atual e próximos).
 * Uso autorizado pelo responsável do AskouT. Pedidos em fila curta e com pausa, para não pesar no site.
 */
export const SESC_SOURCE = 'sesc-sp';
const SITE = 'https://www.sescsp.org.br';
const UA = { 'User-Agent': 'AskouT-importer/1.0 (+https://askout.com.br)' };
const DAY = 86_400_000;

/** Centro de busca de cada unidade (o Google acha o endereço a partir do nome "Sesc <unidade>"). */
const UNITS: Record<string, { lat: number; lng: number; city: string }> = {
  santos: { lat: -23.9618, lng: -46.3322, city: 'Santos' },
  'mogi das cruzes': { lat: -23.5225, lng: -46.1883, city: 'Mogi das Cruzes' },
};
const SP_CENTER = { lat: -23.5505, lng: -46.6333 };

function decode(text: string): string {
  return text
    .replace(/&#8211;|&ndash;/g, '-').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#038;|&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&bull;|&#8226;/g, '•').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
const textOf = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const unaccent = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface SescPage {
  url: string;
  title: string;
  unit: string;
  category: string;
  presencial: boolean;
  free: boolean;
  place: string;
  description: string;
  image: string | null;
  /** Dia, mês, hora e minuto de início e de fim (quando há) de cada data. */
  dates: { day: number; month: number; sh: number; sm: number; eh?: number; em?: number }[];
}

/** Lê uma página de atividade. Sem título, unidade ou data legível, devolve undefined. */
export function parseSescPage(html: string, url: string): SescPage | undefined {
  const rawTitle = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? /<meta property="og:title" content="([^"]+)"/.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '';
  const title = textOf(rawTitle).replace(/\s*[-|–]\s*Sesc S[ãa]o Paulo\s*$/i, '').replace(/\s*:\s*Sesc S[ãa]o Paulo\s*$/i, '');
  const flat = textOf(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '));
  const crumbs = /Home\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/.exec(flat);
  const unit = crumbs?.[1]?.trim() ?? '';
  const category = crumbs?.[2]?.trim() ?? '';
  if (title === '' || unit === '') return undefined;
  const dates: SescPage['dates'] = [];
  const re = /(\d{2})\/(\d{2})\s*•\s*[A-Za-zÀ-ú-]+\s*•\s*(?:das\s*)?(\d{1,2})h(\d{2})(?:\s*(?:às|a)\s*(\d{1,2})h(\d{2}))?/g;
  for (const m of flat.matchAll(re)) dates.push({ day: Number(m[1]), month: Number(m[2]), sh: Number(m[3]), sm: Number(m[4]), ...(m[5] ? { eh: Number(m[5]), em: Number(m[6]) } : {}) });
  if (dates.length === 0) return undefined;
  const place = /Local:\s*([^.]*?)(?:\s{2,}|Sem retirada|Retirada|Ingresso|Data e hor|$)/.exec(flat)?.[1]?.trim() ?? '';
  const body = (flat.split(/Compartilhe:?/i)[1] ?? '').slice(0, 900).trim();
  const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? null;
  return {
    url,
    title,
    unit,
    category,
    presencial: /atividade presencial/i.test(flat),
    free: /\bGr[aá]tis\b/i.test(flat),
    place,
    description: body,
    image: image && /^https:\/\//.test(image) ? image : null,
    dates,
  };
}

/** Ano de uma data sem ano: a mais próxima de hoje para a frente (até uns 2 meses para trás conta como este ano). */
function yearOf(month: number, day: number, now: Date): number {
  const y = new Date(now.getTime() - 3 * 3_600_000).getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day);
  return candidate < now.getTime() - 60 * DAY ? y + 1 : y;
}

export function sescEvents(page: SescPage, now: Date, horizonDays = 75): ImportedEvent[] {
  if (!page.presencial) return [];
  const unitKey = unaccent(page.unit);
  const unit = UNITS[unitKey];
  const out: ImportedEvent[] = [];
  for (const d of page.dates) {
    const year = yearOf(d.month, d.day, now);
    const startsAt = new Date(Date.UTC(year, d.month - 1, d.day, d.sh + 3, d.sm));
    let endsAt = d.eh !== undefined ? new Date(Date.UTC(year, d.month - 1, d.day, d.eh + 3, d.em ?? 0)) : new Date(startsAt.getTime() + 2 * 3_600_000);
    if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(endsAt.getTime() + DAY);
    if (endsAt.getTime() < now.getTime() || startsAt.getTime() > now.getTime() + horizonDays * DAY) continue;
    const stamp = startsAt.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    out.push({
      source: SESC_SOURCE,
      sourceId: `${new URL(page.url).pathname.replace(/\/$/, '').split('/').pop()}-${stamp}`,
      title: page.title.slice(0, 120),
      description: [page.description, page.place ? `Local: ${page.place}` : ''].filter((t) => t !== '').join('\n\n').slice(0, 900),
      startsAt,
      endsAt,
      venueName: `Sesc ${page.unit}`.slice(0, 80),
      address: null,
      isFree: page.free,
      imageUrl: page.image,
      link: page.url,
      sourceName: 'Sesc São Paulo',
      area: { name: unit?.city ?? 'São Paulo', lat: unit?.lat ?? SP_CENTER.lat, lng: unit?.lng ?? SP_CENTER.lng },
    });
  }
  return out;
}

/** Categorias de turma fixa, esporte de aula e serviços (não encontro). Palestra, oficina e curso ficam. */
export const SESC_SKIP_CATEGORY = /turma|ginastica|natacao|esporte|atividade fisica|leitura|biblioteca|turismo|saude|alimentacao|cuidado/i;

export async function fetchSescEvents(now: Date, options: { fetcher?: typeof fetch; maxPages?: number; sitemapCount?: number } = {}): Promise<ImportedEvent[]> {
  const doFetch = options.fetcher ?? fetch;
  const index = await doFetch(`${SITE}/sitemap_index.xml`, { headers: UA });
  if (!index.ok) throw new Error(`sitemap HTTP ${index.status}`);
  const maps = [...(await index.text()).matchAll(/sesc-eventos-sitemap(\d*)\.xml/g)].map((m) => Number(m[1] || 1)).sort((a, b) => b - a);
  const urls: { url: string; at: number }[] = [];
  for (const n of maps.slice(0, options.sitemapCount ?? 2)) {
    const res = await doFetch(`${SITE}/sesc-eventos-sitemap${n === 1 ? '' : n}.xml`, { headers: UA });
    if (!res.ok) continue;
    for (const m of (await res.text()).matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) urls.push({ url: m[1]!, at: Date.parse(m[2]!) });
  }
  const recent = urls.filter((u) => u.at >= now.getTime() - 45 * DAY).sort((a, b) => b.at - a.at).slice(0, options.maxPages ?? 150);
  const out: ImportedEvent[] = [];
  for (let i = 0; i < recent.length; i += 4) {
    const batch = recent.slice(i, i + 4);
    const pages = await Promise.all(batch.map(async ({ url }) => {
      try {
        const res = await doFetch(url, { headers: UA });
        return res.ok ? parseSescPage(await res.text(), url) : undefined;
      } catch {
        return undefined;
      }
    }));
    for (const page of pages) {
      if (!page || SESC_SKIP_CATEGORY.test(unaccent(page.category))) continue;
      out.push(...sescEvents(page, now));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}
