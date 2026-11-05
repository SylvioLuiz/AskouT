import { useEffect, useRef, useState } from 'react';
import type { Map as GlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { t } from '../lib/i18n/index.ts';

// Mapa do encontro: OpenStreetMap (tiles raster) desenhado pelo MapLibre. Carregado sob demanda, só na tela
// do encontro, porque a biblioteca é grande. Os pins só existem aqui, depois do aceite do convite.

export interface MapPin {
  lat: number;
  lng: number;
}

export interface OtherPin extends MapPin {
  /** Identifica o pin (o id do encontro), para atualizar em vez de recriar. */
  id: string;
  stale: boolean;
  /** Iniciais da pessoa, desenhadas dentro do pin. */
  initials: string;
}

/** Lugar sugerido entre os dois (bar, evento): um pin numerado que se toca para escolher. */
export interface PlacePin extends MapPin {
  key: string;
  name: string;
}

/** Trajeto de uma pessoa até o lugar: `line` nulo desenha uma linha reta tracejada. */
export interface RouteLine {
  from: MapPin;
  line: [number, number][] | null;
}

interface Props {
  me: MapPin | undefined;
  others: readonly OtherPin[];
  places?: readonly PlacePin[];
  selectedKey?: string | undefined;
  onPick?: ((key: string) => void) | undefined;
  /** Lugar escolhido pelos dois. */
  destination?: (MapPin & { name: string }) | undefined;
  routes?: { me?: RouteLine | undefined; them?: RouteLine | undefined } | undefined;
  onFail: () => void;
}

const STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

type Lib = typeof import('maplibre-gl');

function pinElement(className: string, text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

export default function MatchMap({ me, others, places = [], selectedKey, onPick, destination, routes, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: GlMap; lib: Lib; me?: Marker; others: Map<string, Marker>; places: Map<string, Marker>; dest?: Marker; fitKey: string } | undefined>(undefined);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const [ready, setReady] = useState(false);
  const [styleReady, setStyleReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        const map = new lib.Map({
          container: box.current,
          style: STYLE,
          center: [-46.6333, -23.5505],
          zoom: 14,
          attributionControl: { compact: true },
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        live.current = { map, lib, others: new Map(), places: new Map(), fitKey: '' };
        map.on('load', () => {
          if (cancelled) return;
          map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          // As cores das rotas vêm dos mesmos tokens da legenda (você = marca, a outra pessoa = aviso).
          const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
          const color = ['match', ['get', 'who'], 'me', css('--brand', 'blue'), css('--warn', 'orange')] as never;
          map.addLayer({ id: 'routes-solid', type: 'line', source: 'routes', filter: ['!=', ['get', 'dashed'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.85 } });
          map.addLayer({ id: 'routes-dashed', type: 'line', source: 'routes', filter: ['==', ['get', 'dashed'], true], paint: { 'line-color': color, 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
          setStyleReady(true);
        });
        setReady(true);
      } catch {
        if (!cancelled) failRef.current();
      }
    })();
    return () => {
      cancelled = true;
      live.current?.map.remove();
      live.current = undefined;
    };
  }, []);

  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map, lib } = state;

    // Seu pin.
    if (!me) {
      state.me?.remove();
      state.me = undefined;
    } else if (state.me) state.me.setLngLat([me.lng, me.lat]);
    else state.me = new lib.Marker({ element: pinElement('pin pin--me', '') }).setLngLat([me.lng, me.lat]).addTo(map);

    // Um pin por pessoa que aceitou sair com você; some quando o encontro acaba.
    const wanted = new Set(others.map((o) => o.id));
    for (const [id, marker] of state.others) {
      if (!wanted.has(id)) {
        marker.remove();
        state.others.delete(id);
      }
    }
    for (const other of others) {
      let marker = state.others.get(other.id);
      if (marker) marker.setLngLat([other.lng, other.lat]);
      else {
        marker = new lib.Marker({ element: pinElement('pin pin--them', other.initials) }).setLngLat([other.lng, other.lat]).addTo(map);
        state.others.set(other.id, marker);
      }
      marker.getElement().classList.toggle('pin--stale', other.stale);
    }

    // Reenquadra só quando aparece ou some um pin, para não tirar o mapa do lugar enquanto a pessoa o move.
    const fitKey = `${me ? 'm' : ''}|${[...wanted].sort().join(',')}`;
    if (fitKey !== state.fitKey && fitKey !== '|') {
      state.fitKey = fitKey;
      const points: MapPin[] = [...(me ? [me] : []), ...others];
      const first = points[0] as MapPin;
      if (points.length === 1) {
        map.easeTo({ center: [first.lng, first.lat], zoom: 16, duration: 0 });
      } else {
        const bounds = new lib.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
        for (const point of points) bounds.extend([point.lng, point.lat]);
        map.fitBounds(bounds, { padding: 64, maxZoom: 17, duration: 0 });
      }
    }
  }, [ready, me, others]);

  // Lugares sugeridos: pins numerados; o selecionado fica em destaque.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map, lib } = state;
    const wanted = new Set(places.map((p) => p.key));
    for (const [key, marker] of state.places) {
      if (!wanted.has(key)) {
        marker.remove();
        state.places.delete(key);
      }
    }
    places.forEach((place, index) => {
      let marker = state.places.get(place.key);
      if (!marker) {
        const el = pinElement('pin pin--place', String(index + 1));
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', place.name);
        el.tabIndex = 0;
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          pickRef.current?.(place.key);
        });
        marker = new lib.Marker({ element: el }).setLngLat([place.lng, place.lat]).addTo(map);
        state.places.set(place.key, marker);
      }
      marker.getElement().classList.toggle('pin--selected', place.key === selectedKey);
    });
  }, [ready, places, selectedKey]);

  // Lugar escolhido pelos dois.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map, lib } = state;
    if (!destination) {
      state.dest?.remove();
      state.dest = undefined;
      return;
    }
    if (state.dest) state.dest.setLngLat([destination.lng, destination.lat]);
    else {
      const el = pinElement('pin pin--dest', '★');
      el.setAttribute('aria-label', destination.name);
      state.dest = new lib.Marker({ element: el }).setLngLat([destination.lng, destination.lat]).addTo(map);
    }
  }, [ready, destination]);

  // Rota de cada um até o lugar: trajeto de verdade, ou linha reta tracejada se não houver.
  useEffect(() => {
    const state = live.current;
    if (!ready || !styleReady || !state) return;
    const source = state.map.getSource('routes') as { setData(data: unknown): void } | undefined;
    if (!source) return;
    const features: unknown[] = [];
    if (destination) {
      for (const [who, route] of [['me', routes?.me], ['them', routes?.them]] as const) {
        if (!route) continue;
        const coordinates = route.line ?? [[route.from.lng, route.from.lat], [destination.lng, destination.lat]];
        features.push({ type: 'Feature', properties: { who, dashed: route.line === null }, geometry: { type: 'LineString', coordinates } });
      }
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [ready, styleReady, destination, routes]);

  // Ao escolher o lugar, enquadra os dois e o destino.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state || !destination) return;
    const key = `${destination.lat},${destination.lng}`;
    if (state.fitKey.endsWith(`>${key}`)) return;
    state.fitKey = `${state.fitKey.split('>')[0] ?? ''}>${key}`;
    const points: MapPin[] = [destination, ...(me ? [me] : []), ...others];
    const bounds = new state.lib.LngLatBounds([destination.lng, destination.lat], [destination.lng, destination.lat]);
    for (const point of points) bounds.extend([point.lng, point.lat]);
    state.map.fitBounds(bounds, { padding: 64, maxZoom: 17, duration: 400 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, destination]);

  return <div ref={box} className="matchmap" role="region" aria-label={t('Mapa com a posição de vocês dois')} />;
}
