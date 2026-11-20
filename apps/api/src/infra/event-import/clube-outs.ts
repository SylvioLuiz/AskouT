import type { ImportedEvent } from './niche.ts';

/**
 * Clube Outs (Rua Augusta, 486, https://www.clubeouts.com.br/#Agenda): a agenda é HTML na própria página inicial, um cartão por
 * festa com imagem, "Data: dd/mm/aaaa (dia)" e o nome da festa. A página não informa horário: usamos 23h às 5h (balada) e
 * dizemos na descrição que o horário deve ser confirmado com a casa. A página vem em windows-1252. Uso autorizado pelo
 * responsável do AskouT.
 */
export const CLUBE_OUTS_SOURCE = 'clube-outs';
const PAGE = 'https://www.clubeouts.com.br/';
const AREA = { name: 'São Paulo', lat: -23.5505, lng: -46.6333 };

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
const textOf = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Extrai as festas do HTML da agenda. Só as que ainda não passaram. */
export function parseClubeOuts(html: string, now: Date): ImportedEvent[] {
  const out: ImportedEvent[] = [];
  const seen = new Set<string>();
  for (const card of html.split(/Verificar\('/i).slice(1)) {
    const block = card.split(/Verificar\('/i)[0] ?? card;
    const day = /Data:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(block);
    if (!day) continue;
    // O nome da festa vem depois do dia da semana, dentro do mesmo <B>.
    const afterDay = block.slice(block.indexOf(day[0]));
    const title = textOf(/\)\s*<BR>([\s\S]*?)<\/B>/i.exec(afterDay)?.[1] ?? '');
    if (title === '') continue;
    const [d, m, y] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const startsAt = new Date(Date.UTC(y, m - 1, d, 23 + 3, 0));
    const endsAt = new Date(startsAt.getTime() + 6 * 3_600_000);
    if (endsAt.getTime() < now.getTime()) continue;
    const sourceId = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}-${title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const image = /<img src=(https:\/\/[^\s>]+)/i.exec(block)?.[1] ?? null;
    out.push({
      source: CLUBE_OUTS_SOURCE,
      sourceId,
      title: title.slice(0, 120),
      description: 'Festa no Clube Outs, o clube underground da Rua Augusta, com duas pistas (rock no térreo; funk, pop e eletrônico no piso de cima). Horário a confirmar com a casa.',
      startsAt,
      endsAt,
      venueName: 'Clube Outs',
      address: 'Rua Augusta, 486 - Consolação - São Paulo - SP',
      isFree: false,
      imageUrl: image,
      link: `${PAGE}#Agenda`,
      sourceName: 'Clube Outs',
      area: AREA,
    });
  }
  return out;
}

export async function fetchClubeOutsEvents(now: Date, fetcher: typeof fetch = fetch): Promise<ImportedEvent[]> {
  const res = await fetcher(PAGE, { headers: { 'User-Agent': 'AskouT-importer/1.0 (+https://askout.com.br)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseClubeOuts(new TextDecoder('windows-1252').decode(await res.arrayBuffer()), now);
}
