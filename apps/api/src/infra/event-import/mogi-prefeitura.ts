import type { ImportedEvent } from './niche.ts';

/**
 * Agenda da Prefeitura de Mogi das Cruzes (https://www.mogidascruzes.sp.gov.br/eventos-festas), só HTML. Cada item traz
 * dia, mês, título, local (às vezes vazio) e hora, sem ano nem fim. Fica só o que ainda vai acontecer e tem local
 * (sem local não dá para achar o lugar no mapa). Exposições de longa duração e visitas fixas não são rolê e saem pelo filtro.
 */
export const MOGI_SOURCE = 'prefeitura-mogi';
const PAGE = 'https://www.mogidascruzes.sp.gov.br/eventos-festas';
const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

function decode(text: string): string {
  return text
    .replace(/&ccedil;/g, 'ç').replace(/&Ccedil;/g, 'Ç').replace(/&atilde;/g, 'ã').replace(/&otilde;/g, 'õ').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&acirc;/g, 'â').replace(/&ecirc;/g, 'ê').replace(/&ocirc;/g, 'ô')
    .replace(/&agrave;/g, 'à').replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
const textOf = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const unaccent = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Extrai os itens do HTML da agenda. A página não traz ano: vale o ano em curso. */
export function parseMogiAgenda(html: string, now: Date): ImportedEvent[] {
  const out: ImportedEvent[] = [];
  const year = new Date(now.getTime() - 3 * 3_600_000).getUTCFullYear();
  const blocks = html.split('<div class="data-evento">').slice(1);
  for (const block of blocks) {
    const day = Number(/<h3>\s*(\d{1,2})\s*<\/h3>/.exec(block)?.[1]);
    const month = MONTHS[unaccent(textOf(/<p>\s*([^<]+?)\s*<\/p>/.exec(block)?.[1] ?? ''))];
    const title = textOf(/<h4>([\s\S]*?)<\/h4>/.exec(block)?.[1] ?? '');
    if (!day || !month || title === '') continue;
    const paragraphs = [...block.matchAll(/glyphicon-([a-z-]+)[\s\S]*?<\/span>([\s\S]*?)<\/p>/g)].map((m) => ({ icon: m[1]!, text: textOf(m[2]!) }));
    const venueName = paragraphs.find((p) => p.icon === 'map-marker')?.text ?? '';
    const clock = /(\d{1,2}):(\d{2})/.exec(paragraphs.find((p) => p.icon === 'time')?.text ?? '');
    if (venueName === '') continue;
    const hour = clock ? Number(clock[1]) : 19;
    const minute = clock ? Number(clock[2]) : 0;
    const startsAt = new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
    if (startsAt.getTime() < now.getTime()) continue;
    out.push({
      source: MOGI_SOURCE,
      sourceId: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${unaccent(title).replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
      title: title.slice(0, 120),
      description: '',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
      venueName: venueName.slice(0, 80),
      address: null,
      isFree: true,
      imageUrl: null,
      link: PAGE,
      sourceName: 'Prefeitura de Mogi das Cruzes',
      area: { name: 'Mogi das Cruzes', lat: -23.5225, lng: -46.1883 },
    });
  }
  return out;
}

export async function fetchMogiEvents(now: Date, fetcher: typeof fetch = fetch): Promise<ImportedEvent[]> {
  const res = await fetcher(PAGE, { headers: { 'User-Agent': 'AskouT-importer/1.0 (+https://askout.com.br)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseMogiAgenda(await res.text(), now);
}
