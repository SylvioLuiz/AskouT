import type { ImportedEvent } from './niche.ts';

/**
 * Centro Cultural São Paulo (https://centrocultural.sp.gov.br), que expõe no WordPress os tipos `sessao` (data, horário,
 * ingresso, recorrência) e `evento` (título, texto, imagem). A sessão e o evento têm o mesmo `slug`. Sessões semanais
 * viram uma ocorrência por semana até a data final (ou 45 dias). Uso autorizado pelo responsável do AskouT.
 */
export const CCSP_SOURCE = 'ccsp';
const BASE = 'https://centrocultural.sp.gov.br/wp-json/wp/v2';
const HORIZON_DAYS = 45;
const DAY = 86_400_000;
const AREA = { name: 'São Paulo', lat: -23.5712, lng: -46.6439 };

export interface CcspSession {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  meta: {
    valor_ingresso?: string;
    link_ingresso?: string;
    data_inicio?: number | string;
    horario_inicio?: string;
    horario_termino?: string;
    recorrencia_tipo?: string;
    recorrencia_fim?: number | string;
  };
}

export interface CcspEvent {
  slug: string;
  link: string;
  excerpt?: { rendered: string };
  content?: { rendered: string };
  _embedded?: { 'wp:featuredmedia'?: { source_url?: string }[] };
}

function decode(text: string): string {
  return text
    .replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#038;|&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&hellip;|&#8230;/g, '…')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
const textOf = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function clock(value: string | undefined, fallback: [number, number]): [number, number] {
  const m = /(\d{1,2})[:h](\d{2})/.exec(value ?? '');
  return m ? [Number(m[1]), Number(m[2])] : fallback;
}

/** Ocorrências futuras (dentro do horizonte) de uma sessão. O dia vem em segundos, à meia-noite UTC do dia civil. */
export function sessionEvents(session: CcspSession, info: CcspEvent | undefined, now: Date): ImportedEvent[] {
  const startDay = Number(session.meta.data_inicio) * 1000;
  if (!Number.isFinite(startDay) || startDay <= 0) return [];
  const title = textOf(session.title.rendered);
  if (title === '') return [];
  const [sh, sm] = clock(session.meta.horario_inicio, [19, 0]);
  const [eh, em] = clock(session.meta.horario_termino, [(sh + 2) % 24, sm]);
  const weekly = session.meta.recorrencia_tipo === 'semanal';
  const lastDay = weekly ? Math.min(Number(session.meta.recorrencia_fim) * 1000 || startDay, now.getTime() + HORIZON_DAYS * DAY) : startDay;
  const price = (session.meta.valor_ingresso ?? '').trim();
  const isFree = price === '' || /^(r\$\s*0([,.]0+)?|gr[aá]tis|gratuito|livre|free)$/i.test(price);
  const description = textOf(info?.excerpt?.rendered ?? info?.content?.rendered ?? '').slice(0, 900);
  const image = info?._embedded?.['wp:featuredmedia']?.[0]?.source_url;
  const out: ImportedEvent[] = [];
  for (let day = startDay; day <= lastDay; day += 7 * DAY) {
    const d = new Date(day);
    const startsAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh + 3, sm));
    let endsAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), eh + 3, em));
    if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(endsAt.getTime() + DAY);
    if (endsAt.getTime() < now.getTime() || startsAt.getTime() > now.getTime() + HORIZON_DAYS * DAY) {
      if (!weekly) break;
      continue;
    }
    out.push({
      source: CCSP_SOURCE,
      sourceId: `${session.id}-${startsAt.toISOString().slice(0, 10)}`,
      title: title.slice(0, 120),
      description,
      startsAt,
      endsAt,
      venueName: 'Centro Cultural São Paulo',
      address: 'Rua Vergueiro, 1000 - Liberdade, São Paulo - SP',
      isFree,
      imageUrl: image && /^https:\/\//.test(image) ? image : null,
      link: info?.link ?? session.link,
      sourceName: 'Centro Cultural São Paulo',
      area: AREA,
    });
    if (!weekly) break;
  }
  return out;
}

export async function fetchCcspEvents(now: Date, fetcher: typeof fetch = fetch): Promise<ImportedEvent[]> {
  const headers = { 'User-Agent': 'AskouT-importer/1.0 (+https://askout.com.br)' };
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await fetcher(`${BASE}/${path}`, { headers });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  };
  const sessions: CcspSession[] = [];
  const infoBySlug = new Map<string, CcspEvent>();
  for (let page = 1; page <= 3; page++) {
    const rows = await get<CcspSession>(`sessao?per_page=100&page=${page}&orderby=date&order=desc&_fields=id,slug,link,title,meta`);
    if (rows.length === 0) break;
    sessions.push(...rows);
    const events = await get<CcspEvent>(`evento?per_page=100&page=${page}&orderby=date&order=desc&_embed=wp:featuredmedia&_fields=slug,link,excerpt,content,_links,_embedded`);
    for (const e of events) infoBySlug.set(e.slug, e);
  }
  return sessions.flatMap((s) => sessionEvents(s, infoBySlug.get(s.slug), now));
}
