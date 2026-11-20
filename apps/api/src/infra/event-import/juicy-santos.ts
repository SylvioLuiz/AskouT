import type { ImportedEvent } from './niche.ts';

/**
 * Lê os eventos do Juicy Santos (guia da Baixada Santista, https://www.juicysantos.com.br/eventos-na-regiao/), que o
 * WordPress deles expõe em /wp-json/wp/v2/event. Uso autorizado pelo responsável do AskouT junto ao Juicy; cada evento
 * importado guarda o link da página de origem como crédito.
 */
export const JUICY_SOURCE = 'juicy-santos';
const API = 'https://www.juicysantos.com.br/wp-json/wp/v2/event';

const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

function decode(text: string): string {
  return text
    .replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
const textOf = (html: string): string => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const unaccent = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** "20 novembro 26" → [2026, 11, 20]. */
function parseDay(text: string): [number, number, number] | undefined {
  const m = /(\d{1,2})\s+([A-Za-zçÇãÃ]+)\s+(\d{2,4})/.exec(text);
  if (!m) return undefined;
  const month = MONTHS[unaccent(m[2]!)];
  if (!month) return undefined;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return [year, month, Number(m[1])];
}

/** Hora de São Paulo (UTC-3, sem horário de verão) para UTC. */
function saoPaulo(day: [number, number, number], hour: number, minute: number): Date {
  return new Date(Date.UTC(day[0], day[1] - 1, day[2], hour + 3, minute));
}

export interface JuicyRow {
  id: number;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

/** Converte uma linha da API em evento. Sem data, local ou título legível, devolve undefined. */
export function parseJuicyEvent(row: JuicyRow): ImportedEvent | undefined {
  const html = row.content.rendered;
  const title = textOf(row.title.rendered);
  const when = /em-event-date[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const [firstText, lastText] = textOf(when).split(/\s+-\s+(?=\d{1,2}\s+[A-Za-z])/);
  const first = parseDay(firstText ?? '');
  const last = parseDay(lastText ?? firstText ?? '') ?? first;
  if (!first || !last || title === '') return undefined;
  const time = /em-event-time[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const [startClock, endClock] = (textOf(time).match(/\d{1,2}:\d{2}/g) ?? []) as [string?, string?];
  const clock = (value: string | undefined, fallback: [number, number]): [number, number] => {
    const m = /(\d{1,2}):(\d{2})/.exec(value ?? '');
    return m ? [Number(m[1]), Number(m[2])] : fallback;
  };
  const [sh, sm] = clock(startClock, [20, 0]);
  const [eh, em] = clock(endClock, [(sh + 3) % 24, sm]);
  const startsAt = saoPaulo(first, sh, sm);
  let endsAt = saoPaulo(last, eh, em);
  // Termina de madrugada (ex.: 22:00 - 3:00 no mesmo dia): é o dia seguinte.
  if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(endsAt.getTime() + 86_400_000);
  const where = /em-event-location[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
  const venueName = textOf(/<a [^>]*>([\s\S]*?)<\/a>/.exec(where)?.[1] ?? '');
  const address = textOf(/<br\s*\/?>([\s\S]*?)<\/div>/.exec(where)?.[1] ?? '') || null;
  if (venueName === '') return undefined;
  const price = textOf(/em-event-quanto[\s\S]*?<\/i>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');
  const isFree = /^(r\$\s*0([,.]0+)?|gr[aá]tis|gratuito|free)$/i.test(price);
  const image = /em-item-image[\s\S]*?<img [^>]*src=['"]([^'"]+)['"]/.exec(html)?.[1] ?? null;
  const body = textOf(/em-event-content">([\s\S]*?)<h2>/.exec(html)?.[1] ?? /em-event-content">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '');
  return {
    source: JUICY_SOURCE,
    sourceId: String(row.id),
    title: title.slice(0, 120),
    description: body.slice(0, 900),
    startsAt,
    endsAt,
    venueName: venueName.slice(0, 80),
    address: address ? address.slice(0, 200) : null,
    isFree,
    imageUrl: image && /^https:\/\//.test(image) ? image : null,
    link: row.link,
  };
}

/**
 * Busca os eventos mais recentes cadastrados no Juicy (a API ordena pela publicação) e devolve os que ainda vão
 * acontecer. Para quando uma página inteira é mais antiga que `maxAgeDays` de publicação.
 */
export async function fetchJuicyEvents(now: Date, options: { maxPages?: number; maxAgeDays?: number; fetcher?: typeof fetch } = {}): Promise<ImportedEvent[]> {
  const doFetch = options.fetcher ?? fetch;
  const maxPages = options.maxPages ?? 6;
  const cutoff = now.getTime() - (options.maxAgeDays ?? 75) * 86_400_000;
  const out: ImportedEvent[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await doFetch(`${API}?per_page=50&page=${page}&orderby=date&order=desc&_fields=id,date_gmt,link,title,content`, { headers: { 'User-Agent': 'AskouT-importer/1.0 (+https://askout.com.br)' } });
    if (!res.ok) break;
    const rows = (await res.json()) as (JuicyRow & { date_gmt: string })[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const event = parseJuicyEvent(row);
      if (event && event.endsAt.getTime() >= now.getTime()) out.push(event);
    }
    if (rows.every((r) => Date.parse(`${r.date_gmt}Z`) < cutoff)) break;
  }
  return out;
}
