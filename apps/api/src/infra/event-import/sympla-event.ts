import type { ImportedEvent } from './niche.ts';

/**
 * Lê UM evento da página pública do Sympla (a que qualquer pessoa abre pelo link), que traz os dados do evento embutidos
 * (`__NEXT_DATA__`): título, datas, local com coordenadas, preço e imagem. Não existe busca pública no Sympla e a página do
 * produtor carrega a lista por dentro do app, então os eventos entram por link, um a um: a equipe cola os links dos
 * eventos futuros das casas em `apps/api/scripts/event-urls.txt`. Uso autorizado pelo responsável do AskouT.
 * Para ter a agenda inteira de uma casa sem colar links, o caminho é a API oficial do Sympla com o token do produtor.
 */
export const SYMPLA_SOURCE = 'sympla';

interface SymplaEventData {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  strippedDetail?: string;
  detail?: string;
  slug?: string;
  newUrl?: string;
  logoUrl?: string;
  paymentEventType?: string;
  published?: boolean;
  cancelled?: boolean;
  privateEvent?: boolean;
  onlineInfo?: unknown;
  eventsAddress?: { name?: string; address?: string; addressNum?: string; neighborhood?: string; city?: string; state?: string; geolocation?: { latitude?: number; longitude?: number } };
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

/** "2026-11-28 20:00:00" (hora de São Paulo) → instante. */
function spTime(text: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text);
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + 3, Number(m[5])));
}

/** Lê o evento do HTML da página. Cancelado, privado, online, sem data ou sem local devolve undefined. */
export function parseSymplaEvent(html: string, url: string): ImportedEvent | undefined {
  const raw = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) return undefined;
  let event: SymplaEventData | undefined;
  try {
    const data = JSON.parse(raw) as { props?: { pageProps?: { hydrationData?: { eventHydration?: { event?: SymplaEventData } } } } };
    event = data.props?.pageProps?.hydrationData?.eventHydration?.event;
  } catch {
    return undefined;
  }
  if (!event || event.cancelled === true || event.privateEvent === true || event.published === false || event.onlineInfo) return undefined;
  const startsAt = spTime(event.startDate);
  const endsAt = spTime(event.endDate);
  const place = event.eventsAddress;
  if (!startsAt || !endsAt || !place?.name) return undefined;
  const street = [place.address, place.addressNum].filter(Boolean).join(', ');
  const address = [street, place.neighborhood, place.city && place.state ? `${place.city} - ${place.state}` : place.city].filter(Boolean).join(' - ');
  const lat = place.geolocation?.latitude;
  const lng = place.geolocation?.longitude;
  const body = decode((event.strippedDetail ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return {
    source: SYMPLA_SOURCE,
    sourceId: String(event.id),
    title: decode(event.name).replace(/\s+/g, ' ').trim().slice(0, 120),
    description: body.slice(0, 900),
    startsAt,
    endsAt: endsAt.getTime() > startsAt.getTime() ? endsAt : new Date(startsAt.getTime() + 4 * 3_600_000),
    venueName: decode(place.name).slice(0, 80),
    address: address ? address.slice(0, 200) : null,
    isFree: event.paymentEventType === 'free',
    imageUrl: event.logoUrl && /^https:\/\//.test(event.logoUrl) ? event.logoUrl : null,
    link: event.newUrl ?? url,
    sourceName: 'Sympla',
    area: { name: place.city ?? 'São Paulo', lat: typeof lat === 'number' ? lat : -23.5505, lng: typeof lng === 'number' ? lng : -46.6333 },
    ...(typeof lat === 'number' && typeof lng === 'number' ? { coords: { lat, lng } } : {}),
  };
}

/** Só aceita endereços de evento do Sympla (https://www.sympla.com.br/evento/...), nada de outro site. */
export function isSymplaEventUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'www.sympla.com.br' || u.hostname === 'sympla.com.br') && u.pathname.startsWith('/evento/');
  } catch {
    return false;
  }
}

/** Links de um arquivo de texto: um por linha; vazias e comentários (#) são ignorados. */
export function parseUrlList(text: string): string[] {
  return [...new Set(text.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter((l) => l !== ''))].filter(isSymplaEventUrl);
}

export async function fetchSymplaEvents(urls: readonly string[], now: Date, fetcher: typeof fetch = fetch): Promise<ImportedEvent[]> {
  const out: ImportedEvent[] = [];
  for (const url of urls) {
    try {
      const res = await fetcher(url, { headers: { 'User-Agent': 'AskouT-importer/1.0 (+https://askout.com.br)' } });
      if (res.ok) {
        const event = parseSymplaEvent(await res.text(), url);
        if (event && event.endsAt.getTime() >= now.getTime()) out.push(event);
      }
    } catch {
      // link fora do ar: segue com os outros
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}
