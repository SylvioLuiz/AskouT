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

interface Props {
  me: MapPin | undefined;
  others: readonly OtherPin[];
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

export default function MatchMap({ me, others, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: GlMap; lib: Lib; me?: Marker; others: Map<string, Marker>; fitKey: string } | undefined>(undefined);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const [ready, setReady] = useState(false);

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
        live.current = { map, lib, others: new Map(), fitKey: '' };
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

  return <div ref={box} className="matchmap" role="region" aria-label={t('Mapa com a posição de vocês dois')} />;
}
