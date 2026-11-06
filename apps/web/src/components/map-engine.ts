import { distanceMeters } from '../lib/flash.ts';
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
  fit(points: readonly LatLng[], padding: number | Padding, maxZoom: number, animate?: boolean): void;
  /** Troca as linhas desenhadas (rotas). Tracejada para trajeto estimado em linha reta. */
  setLines(lines: readonly MapLine[]): void;
  /** Área visível agora: o centro e o raio (do centro até o canto), em km. */
  view(): MapView | undefined;
  /**
   * Avisa quando o mapa para depois de a pessoa arrastar, dar zoom ou usar os botões de zoom.
   * Os movimentos feitos pelo app (enquadrar, seguir o pin escolhido) não avisam. Devolve a função para parar.
   */
  onUserMove(listener: (view: MapView) => void): () => void;
  destroy(): void;
}

export interface MapView {
  center: LatLng;
  radiusKm: number;
}

export interface MapLine {
  points: readonly LatLng[];
  color: string;
  dashed: boolean;
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

export async function createMapEngine(container: HTMLElement, options: CreateOptions): Promise<MapEngine> {
  const key = env('VITE_GOOGLE_MAPS_API_KEY');
  const { engine, resize } = await (key ? createGoogle(container, options, key) : createMapLibre(container, options));
  return followSize(container, engine, resize);
}

/**
 * O mapa costuma ser criado antes de a tela terminar de montar (carregamento preguiçoso, cartões que entram depois),
 * com a caixa ainda sem o tamanho final: o desenho fica deslocado até recarregar. Aqui o mapa acompanha o tamanho
 * da caixa e, quando ele muda, refaz o último enquadramento.
 */
function followSize(container: HTMLElement, engine: MapEngine, resize: () => void): MapEngine {
  let lastFit: Parameters<MapEngine['fit']> | undefined;
  let lastSize = `${container.clientWidth}x${container.clientHeight}`;
  let frame = 0;
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          const size = `${container.clientWidth}x${container.clientHeight}`;
          if (size === lastSize || container.clientWidth === 0 || container.clientHeight === 0) return;
          lastSize = size;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            resize();
            if (lastFit) engine.fit(lastFit[0], lastFit[1], lastFit[2], false);
          });
        });
  observer?.observe(container);
  // Mesmo sem mudança detectada, confere uma vez depois do primeiro desenho da tela.
  requestAnimationFrame(() => resize());
  return {
    ...engine,
    fit(points, padding, maxZoom, animate) {
      lastFit = [points, padding, maxZoom, animate];
      engine.fit(points, padding, maxZoom, animate);
    },
    moveTo(center, opts) {
      lastFit = undefined;
      engine.moveTo(center, opts);
    },
    destroy() {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      engine.destroy();
    },
  };
}

/** Raio da área visível: do centro até o canto mais distante. */
function viewOf(center: LatLng, corners: readonly LatLng[]): MapView {
  return { center, radiusKm: Math.max(...corners.map((corner) => distanceMeters(center, corner))) / 1000 };
}

/**
 * Separa o movimento da pessoa do movimento do app: guarda a hora do último toque, roda ou arrasto no mapa
 * (fora dos pins, que só escolhem) e, quando o mapa para logo depois disso, avisa quem estiver ouvindo.
 */
function trackUserMoves(container: HTMLElement, view: () => MapView | undefined) {
  const listeners = new Set<(view: MapView) => void>();
  let lastTouch = 0;
  let pressed = false;
  const touched = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('[data-map-marker]')) return;
    lastTouch = Date.now();
    if (event.type === 'pointerdown' || event.type === 'touchstart') pressed = true;
  };
  const released = () => {
    if (pressed) lastTouch = Date.now();
    pressed = false;
  };
  const moved = () => {
    if (pressed) lastTouch = Date.now();
  };
  const types = ['pointerdown', 'touchstart', 'wheel'] as const;
  for (const type of types) container.addEventListener(type, touched, { capture: true, passive: true });
  container.addEventListener('pointermove', moved, { capture: true, passive: true });
  window.addEventListener('pointerup', released, { passive: true });
  window.addEventListener('touchend', released, { passive: true });
  return {
    /** Chamar quando o mapa parar de se mexer. A inércia do arrasto e a animação do zoom cabem nos 1,5 s. */
    settled() {
      if (listeners.size === 0 || (!pressed && Date.now() - lastTouch > 1500)) return;
      const current = view();
      if (current) for (const listener of listeners) listener(current);
    },
    on(listener: (view: MapView) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      listeners.clear();
      for (const type of types) container.removeEventListener(type, touched, { capture: true });
      container.removeEventListener('pointermove', moved, { capture: true });
      window.removeEventListener('pointerup', released);
      window.removeEventListener('touchend', released);
    },
  };
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

async function createGoogle(container: HTMLElement, options: CreateOptions, key: string): Promise<{ engine: MapEngine; resize: () => void }> {
  await loadGoogle(key);
  const [{ Map, OverlayView, Polyline }, core] = await Promise.all([
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
      this.box.dataset['mapMarker'] = '';
      this.box.append(element);
      // Toque num pin clicável não arrasta nem aproxima o mapa.
      if (element instanceof HTMLButtonElement || element.getAttribute('role') === 'button') OverlayView.preventMapHitsAndGesturesFrom(this.box);
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
  let polylines: google.maps.Polyline[] = [];
  const view = (): MapView | undefined => {
    const bounds = map.getBounds();
    const center = map.getCenter();
    if (!bounds || !center) return undefined;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    return viewOf({ lat: center.lat(), lng: center.lng() }, [
      { lat: ne.lat(), lng: ne.lng() },
      { lat: sw.lat(), lng: sw.lng() },
    ]);
  };
  const moves = trackUserMoves(container, view);
  map.addListener('idle', () => moves.settled());
  const engine: MapEngine = {
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
      if (points.length === 0) return;
      const bounds = new core.LatLngBounds();
      for (const p of points) bounds.extend(p);
      map.fitBounds(bounds, padding);
      core.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > maxZoom) map.setZoom(maxZoom);
      });
    },
    setLines(lines) {
      for (const line of polylines) line.setMap(null);
      polylines = lines.map(
        (line) =>
          new Polyline({
            map,
            path: [...line.points],
            strokeColor: line.color,
            strokeWeight: line.dashed ? 4 : 5,
            strokeOpacity: line.dashed ? 0 : 0.85,
            ...(line.dashed ? { icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, scale: 3 }, offset: '0', repeat: '14px' }] } : {}),
          }),
      );
    },
    view,
    onUserMove: (listener) => moves.on(listener),
    destroy() {
      moves.stop();
      authFailures.delete(fail);
      for (const line of polylines) line.setMap(null);
      for (const marker of markers) marker.remove();
      markers.clear();
      core.event.clearInstanceListeners(map);
      container.replaceChildren();
    },
  };
  return { engine, resize: () => {
      // O Google acompanha o tamanho sozinho; só recentra para o desenho não ficar deslocado.
      const center = map.getCenter();
      if (center) map.setCenter(center);
    } };
}

// ---------- MapLibre (sem chave do Google) ----------

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

async function createMapLibre(container: HTMLElement, options: CreateOptions): Promise<{ engine: MapEngine; resize: () => void }> {
  const [lib] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
  const map = new lib.Map({
    container,
    style: env('VITE_MAP_STYLE_URL') ?? OSM_STYLE,
    center: [options.center.lng, options.center.lat],
    zoom: options.zoom,
    attributionControl: { compact: true },
  });
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
  let pendingLines: readonly MapLine[] | undefined;
  let styleLoaded = false;
  const drawLines = (lines: readonly MapLine[]) => {
    const source = map.getSource('lines') as { setData(data: unknown): void } | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: lines.map((line) => ({ type: 'Feature', properties: { color: line.color, dashed: line.dashed }, geometry: { type: 'LineString', coordinates: line.points.map((p) => [p.lng, p.lat]) } })),
    });
  };
  map.on('load', () => {
    map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const color = ['get', 'color'] as never;
    map.addLayer({ id: 'lines-solid', type: 'line', source: 'lines', filter: ['!=', ['get', 'dashed'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'lines-dashed', type: 'line', source: 'lines', filter: ['==', ['get', 'dashed'], true], paint: { 'line-color': color, 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
    styleLoaded = true;
    if (pendingLines) drawLines(pendingLines);
  });
  const view = (): MapView | undefined => {
    const bounds = map.getBounds();
    const center = map.getCenter();
    return viewOf({ lat: center.lat, lng: center.lng }, [
      { lat: bounds.getNorth(), lng: bounds.getEast() },
      { lat: bounds.getSouth(), lng: bounds.getWest() },
    ]);
  };
  const moves = trackUserMoves(container, view);
  map.on('moveend', () => moves.settled());
  const engine: MapEngine = {
    addMarker(element, at, anchor) {
      const marker = new lib.Marker({ element, anchor }).setLngLat([at.lng, at.lat]).addTo(map);
      marker.getElement().dataset['mapMarker'] = '';
      return { element, setPosition: (p) => marker.setLngLat([p.lng, p.lat]), remove: () => marker.remove() };
    },
    moveTo(center, { zoom, raiseBy, animate }) {
      map.easeTo({ center: [center.lng, center.lat], ...(zoom === undefined ? {} : { zoom }), ...(raiseBy ? { offset: [0, -raiseBy] as [number, number] } : {}), duration: animate ? 350 : 0 });
    },
    fit(points, padding, maxZoom, animate) {
      const first = points[0];
      if (!first) return;
      const bounds = new lib.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
      for (const p of points) bounds.extend([p.lng, p.lat]);
      map.fitBounds(bounds, { padding, maxZoom, duration: animate ? 400 : 0 });
    },
    setLines(lines) {
      pendingLines = lines;
      if (styleLoaded) drawLines(lines);
    },
    view,
    onUserMove: (listener) => moves.on(listener),
    destroy() {
      moves.stop();
      map.remove();
    },
  };
  return { engine, resize: () => map.resize() };
}
