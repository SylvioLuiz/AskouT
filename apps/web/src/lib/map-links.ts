// Links para abrir um lugar nos apps de mapa. São endereços https: no celular, o sistema abre o app
// instalado (Google Maps, Apple Mapas, Waze); sem o app, abre o site.

export type MapApp = 'google' | 'apple' | 'waze';
export type MapMode = 'view' | 'route';

export interface MapTarget {
  lat: number | null;
  lng: number | null;
  /** Nome do lugar, mostrado no pin do Apple Mapas e usado na busca quando não há coordenada. */
  label?: string | null;
  address?: string | null;
  /** Link do próprio Google para o lugar (vem do Places), preferido para ver no Google Maps. */
  googleUrl?: string | null;
  /** Meio de transporte da rota (Google Maps e Apple Mapas). Sem ele, o app escolhe. */
  travel?: 'walking' | 'driving';
  /** Ponto de partida da rota (sua posição, quando o app já tem). Sem ele, o app de mapa usa a localização do aparelho. */
  from?: { lat: number; lng: number } | undefined;
  /** No computador o Waze abre o site, que só traça a rota com o ponto de partida no endereço. */
  desktop?: boolean;
}

export const MAP_APPS: readonly MapApp[] = ['google', 'apple', 'waze'];

/** Aparelho da Apple (iPhone, iPad, iPod ou Mac), o único onde o Apple Mapas abre. O iPad novo se apresenta como Mac. */
export function isAppleDevice(userAgent: string, platform = ''): boolean {
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(userAgent) || /^(Mac|iPhone|iPad|iPod)/.test(platform);
}

/** Apps de mapa que fazem sentido neste aparelho: fora da Apple não oferece o Apple Mapas. */
export function mapAppsFor(userAgent: string, platform = ''): readonly MapApp[] {
  return isAppleDevice(userAgent, platform) ? MAP_APPS : MAP_APPS.filter((app) => app !== 'apple');
}

export const MAP_APP_NAMES: Readonly<Record<MapApp, string>> = { google: 'Google Maps', apple: 'Apple Mapas', waze: 'Waze' };

function hasPoint(target: MapTarget): target is MapTarget & { lat: number; lng: number } {
  return target.lat !== null && target.lng !== null;
}

function searchText(target: MapTarget): string {
  return [target.label, target.address].filter((part): part is string => Boolean(part?.trim())).join(', ');
}

/** Pode abrir no mapa: tem coordenada ou, ao menos, um nome ou endereço para buscar. */
export function canOpenInMaps(target: MapTarget): boolean {
  return hasPoint(target) || searchText(target) !== '';
}

export function mapAppLink(app: MapApp, target: MapTarget, mode: MapMode): string {
  const point = hasPoint(target) ? `${target.lat},${target.lng}` : undefined;
  const query = encodeURIComponent(point ?? searchText(target));
  if (app === 'google') {
    if (mode === 'route') return `https://www.google.com/maps/dir/?api=1${target.from ? `&origin=${encodeURIComponent(`${target.from.lat},${target.from.lng}`)}` : ''}&destination=${query}${target.travel ? `&travelmode=${target.travel}` : ''}`;
    if (target.googleUrl?.startsWith('https://')) return target.googleUrl;
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }
  if (app === 'apple') {
    if (mode === 'route') return `https://maps.apple.com/?${target.from ? `saddr=${target.from.lat},${target.from.lng}&` : ''}daddr=${query}${target.travel ? `&dirflg=${target.travel === 'walking' ? 'w' : 'd'}` : ''}`;
    if (!point) return `https://maps.apple.com/?q=${query}`;
    const label = target.label?.trim();
    return `https://maps.apple.com/?ll=${point}&q=${label ? encodeURIComponent(label) : point}`;
  }
  if (mode === 'route' && target.desktop && point && target.from) {
    return `https://www.waze.com/live-map/directions?to=ll.${encodeURIComponent(point)}&from=ll.${encodeURIComponent(`${target.from.lat},${target.from.lng}`)}`;
  }
  const where = point ? `ll=${point}` : `q=${query}`;
  return `https://waze.com/ul?${where}${mode === 'route' ? '&navigate=yes' : ''}`;
}
