import { t } from '../lib/i18n/index.ts';
import type { EventKind, ExplorePlace } from './types.ts';

export type RangeId = 'today' | 'tomorrow' | 'week' | 'weekend' | 'nextweek' | 'month' | 'any';

export const RANGES: readonly { id: RangeId; label: string }[] = [
  { id: 'today', label: t('Hoje') },
  { id: 'tomorrow', label: t('Amanhã') },
  { id: 'week', label: t('Esta semana') },
  { id: 'weekend', label: t('Fim de semana') },
  { id: 'nextweek', label: t('Próxima semana') },
  { id: 'month', label: t('Este mês') },
  { id: 'any', label: t('Próximos 30 dias') },
];

export const KINDS: readonly { id: EventKind; label: string }[] = [
  { id: 'DIGITAL', label: t('Digital') },
  { id: 'SHOW', label: t('Show') },
  { id: 'CINEMA', label: t('Cinema') },
  { id: 'THEATER', label: t('Espetáculos') },
  { id: 'EXHIBITION', label: t('Exposição') },
  { id: 'GASTRONOMY', label: t('Gastronomia') },
  { id: 'NIGHT', label: t('Noite') },
  { id: 'OUTDOOR', label: t('Ar livre') },
  { id: 'SPORT', label: t('Esporte') },
  { id: 'OTHER', label: t('Outros') },
];

/** Igual ao da API: quantas pessoas confirmadas para um evento de agora ser "Bombando". */
export const HOT_MIN_GOING = 5;

export const RADIUS_MIN_KM = 1;
export const RADIUS_MAX_KM = 50;
export const RADIUS_DEFAULT_KM = 10;

export function rangeLabel(id: RangeId): string {
  return RANGES.find((r) => r.id === id)?.label ?? 'Hoje';
}

export function kindLabel(kind: EventKind): string {
  return KINDS.find((k) => k.id === kind)?.label ?? 'Outros';
}

/**
 * Período de cada opção do filtro "Quando", no horário local de quem usa.
 * Semana começa na segunda. O começo nunca é antes de agora (evento que já acabou não entra).
 */
export function rangeFor(id: RangeId, now: Date): { from: Date; to: Date } {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const dow = (now.getDay() + 6) % 7; // segunda = 0
  const untilNextMonday = 7 - dow;
  switch (id) {
    case 'today':
      return { from: now, to: day(1) };
    case 'tomorrow':
      return { from: day(1), to: day(2) };
    case 'week':
      return { from: now, to: day(untilNextMonday) };
    case 'weekend': {
      const saturday = day(5 - dow);
      return { from: dow >= 5 ? now : saturday, to: day(untilNextMonday) };
    }
    case 'nextweek':
      return { from: day(untilNextMonday), to: day(untilNextMonday + 7) };
    case 'month':
      return { from: now, to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
    case 'any':
      return { from: now, to: day(30) };
  }
}

/** Texto realmente enviado à busca: menos de 2 letras (ou só "#") não busca, volta ao que está perto. */
export function effectiveQuery(raw: string): string {
  const q = raw.trim();
  if (q.startsWith('#')) return q.replace(/^#+/, '').trim().length >= 1 ? q : '';
  return q.length >= 2 ? q : '';
}

export function sourceName(source: ExplorePlace['source']): string {
  return source === 'ASKOUT' ? t('Local no AskouT') : source === 'GOOGLE' ? t('Rolê do Google') : t('Rolê do OpenStreetMap');
}

/** Variação de altura da capa na grade (mosaico), estável por evento. */
export function coverShape(id: string): 'tall' | 'square' | 'wide' {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (['tall', 'square', 'wide'] as const)[hash % 3] as 'tall' | 'square' | 'wide';
}

/** Uma imagem de evento só vale se for https. */
let assetBase = '';
/** Endereço da API, para as imagens que ela mesma serve (capas enviadas). */
export function setAssetBase(base: string): void {
  assetBase = base;
}

export function safeImage(url: string | null): string | null {
  if (url === null) return null;
  if (url.startsWith('https://')) return url;
  if (/^\/(place-events|venues)\/[\w-]+\/(cover|logo)(\?v=\d+)?$/.test(url) || /^\/posts\/images\/[\w-]+$/.test(url)) return `${assetBase}${url}`;
  return null;
}

export function activeFilterCount(f: { range: RangeId; kind: EventKind | null; free: boolean; radiusKm: number; hot?: boolean }): number {
  // Com "Bombando" ligado o período não vale, então não conta como filtro.
  return (f.hot ? 1 : f.range !== 'today' ? 1 : 0) + (f.kind ? 1 : 0) + (f.free ? 1 : 0) + (f.radiusKm !== RADIUS_DEFAULT_KM ? 1 : 0);
}
