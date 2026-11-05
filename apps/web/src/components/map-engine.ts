import { intlLocale } from '../lib/i18n/index.ts';

// Motor dos mapas do app. Com VITE_GOOGLE_MAPS_API_KEY definida usa o Google Maps (API JavaScript);
// sem ela cai no MapLibre com o estilo de VITE_MAP_STYLE_URL (ou os blocos públicos do OpenStreetMap, só para desenvolvimento).
// Os componentes de mapa só conversam com esta interface, então trocar de provedor não mexe neles.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface EngineMarker {
  /** O elemento passado ao criar o marcador (para trocar classes e atributos). */
  readonly element: HTMLElement;
  setPosition(at: LatLng): void;
  remove(): void;
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MapEngine {
  /** `bottom`: a ponta de baixo do elemento fica no ponto (pin de gota). `center`: o meio do elemento. */
  addMarker(element: HTMLElement, at: LatLng, anchor: 'center' | 'bottom'): EngineMarker;
  /** Leva o mapa até o ponto. `raiseBy` deixa o ponto tantos pixels acima do centro (para não ficar atrás de um cartão). */
  moveTo(center: LatLng, options: { zoom?: number; raiseBy?: number; animate?: boolean }): void;
  /** Enquadra todos os pontos, sem passar do zoom máximo. */
  fit(points: readonly LatLng[], padding: number | Padding, maxZoom: number): void;
  destroy(): void;
}

interface CreateOptions {
  center: LatLng;
  zoom: number;
  /** Chamado se o provedor recusar depois de carregado (ex.: chave do Google inválida ou sem permissão). */
  onFail: () => void;
}

function env(name: 'VITE_GOOGLE_MAPS_API_KEY' | 'VITE_GOOGLE_MAPS_MAP_ID' | 'VITE_MAP_STYLE_URL'): string | undefined {
  return (import.meta.env[name] as string | undefined)?.trim() || undefined;
}

export function createMapEngine(container: HTMLElement, options: CreateOptions): Promise<MapEngine> {
  const key = env('VITE_GOOGLE_MAPS_API_KEY');
  return key ? createGoogle(container, options, key) : createMapLibre(container, options);
}

// ---------- Google Maps ----------

let googleLoading: Promise<void> | undefined;
const authFailures = new Set<() => void>();

function loadGoogle(key: string): Promise<void> {
  googleLoading ??= new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    w['__askoutMapsReady'] = () => resolve();
    // O Google chama esta função quando a chave é recusada (referenciador não autorizado, API desligada, sem faturamento).
    w['gm_authFailure'] = () => {
      for (const fail of authFailures) fail();
    };
    const script = document.createElement('script');
    const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: '__askoutMapsReady', language: intlLocale() });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      googleLoading = undefined;
      script.remove();
      reject(new Error('Google Maps não carregou'));
    };
    document.head.append(script);
  });
  return googleLoading;
}

async function createGoogle(container: HTMLElement, options: CreateOptions, key: string): Promise<MapEngine> {
  await loadGoogle(key);
  const [{ Map, OverlayView }, core] = await Promise.all([
    google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
    google.maps.importLibrary('core') as Promise<google.maps.CoreLibrary>,
  ]);
  const mapId = env('VITE_GOOGLE_MAPS_MAP_ID');
  const map = new Map(container, {
    center: options.center,
    zoom: options.zoom,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
    clickableIcons: false,
    colorScheme: 'FOLLOW_SYSTEM' as google.maps.ColorScheme,
    // Sem Map ID: esconde os comércios do próprio Google para não brigar com os nossos pins. Com Map ID, o estilo vem do console.
    ...(mapId ? { mapId } : { styles: [{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }] }),
  });
  const fail = options.onFail;
  authFailures.add(fail);

  // Marcador de HTML: mantém os pins desenhados pelo nosso CSS (o marcador avançado do Google exige Map ID).
  class HtmlMarker extends OverlayView implements EngineMarker {
    readonly element: HTMLElement;
    private readonly box = document.createElement('div');
    private at: google.maps.LatLng;

    constructor(element: HTMLElement, at: LatLng, anchor: 'center' | 'bottom') {
      super();
      this.element = element;
      this.at = new core.LatLng(at.lat, at.lng);
      this.box.style.position = 'absolute';
      this.box.style.transform = anchor === 'bottom' ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)';
      this.box.append(element);
      // Toque num pin clicável não arrasta nem aproxima o mapa.
      if (element instanceof HTMLButtonElement) OverlayView.preventMapHitsAndGesturesFrom(this.box);
      this.setMap(map);
    }

    override onAdd(): void {
      this.getPanes()?.overlayMouseTarget.append(this.box);
    }

    override draw(): void {
      const point = this.getProjection()?.fromLatLngToDivPixel(this.at);
      if (!point) return;
      this.box.style.left = `${point.x}px`;
      this.box.style.top = `${point.y}px`;
      // Pin destacado fica por cima dos outros.
      this.box.style.zIndex = this.element.classList.contains('evpin--on') ? '2' : '';
    }

    override onRemove(): void {
      this.box.remove();
    }

    setPosition(at: LatLng): void {
      this.at = new core.LatLng(at.lat, at.lng);
      this.draw();
    }

    remove(): void {
      this.setMap(null);
    }
  }

  const markers = new Set<HtmlMarker>();
  return {
    addMarker(element, at, anchor) {
      const marker = new HtmlMarker(element, at, anchor);
      markers.add(marker);
      return {
        element,
        setPosition: (p) => marker.setPosition(p),
        remove: () => {
          marker.remove();
          markers.delete(marker);
        },
      };
    },
    moveTo(center, { zoom, raiseBy, animate }) {
      if (zoom !== undefined) map.setZoom(zoom);
      let target: google.maps.LatLng | LatLng = center;
      const projection = map.getProjection();
      if (raiseBy && projection) {
        const scale = 2 ** (map.getZoom() ?? 0);
        const point = projection.fromLatLngToPoint(center);
        if (point) target = projection.fromPointToLatLng(new core.Point(point.x, point.y + raiseBy / scale)) ?? center;
      }
      if (animate) map.panTo(target);
      else map.setCenter(target);
      for (const marker of markers) marker.draw();
    },
    fit(points, padding, maxZoom) {
      const bounds = new core.LatLngBounds();
      for (const p of points) bounds.extend(p);
      map.fitBounds(bounds, padding);
      core.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom);
      });
    },
    destroy() {
      authFailures.delete(fail);
      for (const marker of markers) marker.remove();
      markers.clear();
      core.event.clearInstanceListeners(map);
      container.replaceChildren();
    },
  };
}

// ---------- MapLibre (sem chave do Google) ----------

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

async function createMapLibre(container: HTMLElement, options: CreateOptions): Promise<MapEngine> {
  const [lib] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
  const map = new lib.Map({
    container,
    style: env('VITE_MAP_STYLE_URL') ?? OSM_STYLE,
    center: [options.center.lng, options.center.lat],
    zoom: options.zoom,
    attributionControl: { compact: true },
  });
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
  return {
    addMarker(element, at, anchor) {
      const marker = new lib.Marker({ element, anchor }).setLngLat([at.lng, at.lat]).addTo(map);
      return { element, setPosition: (p) => marker.setLngLat([p.lng, p.lat]), remove: () => marker.remove() };
    },
    moveTo(center, { zoom, raiseBy, animate }) {
      map.easeTo({ center: [center.lng, center.lat], ...(zoom === undefined ? {} : { zoom }), ...(raiseBy ? { offset: [0, -raiseBy] as [number, number] } : {}), duration: animate ? 350 : 0 });
    },
    fit(points, padding, maxZoom) {
      const first = points[0];
      if (!first) return;
      const bounds = new lib.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
      for (const p of points) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding, maxZoom, duration: 0 });
    },
    destroy() {
      map.remove();
    },
  };
}
