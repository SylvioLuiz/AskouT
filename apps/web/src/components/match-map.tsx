import { useEffect, useRef, useState } from 'react';
import type { Map as GlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Mapa do encontro: OpenStreetMap (tiles raster) desenhado pelo MapLibre. Carregado sob demanda, só na tela
// do encontro, porque a biblioteca é grande. Os pins só existem aqui, depois do aceite do convite.

export interface MapPin {
  lat: number;
  lng: number;
}

interface Props {
  me: MapPin | undefined;
  them: (MapPin & { stale: boolean }) | undefined;
  /** Iniciais da outra pessoa, desenhadas dentro do pin dela. */
  themInitials: string;
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

export default function MatchMap({ me, them, themInitials, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: GlMap; lib: Lib; me?: Marker; them?: Marker; fitKey: string } | undefined>(undefined);
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
        live.current = { map, lib, fitKey: '' };
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

    const place = (key: 'me' | 'them', point: MapPin | undefined, make: () => HTMLDivElement) => {
      const existing = state[key];
      if (!point) {
        existing?.remove();
        state[key] = undefined;
        return;
      }
      if (existing) existing.setLngLat([point.lng, point.lat]);
      else state[key] = new lib.Marker({ element: make() }).setLngLat([point.lng, point.lat]).addTo(map);
    };
    place('me', me, () => pinElement('pin pin--me', ''));
    place('them', them, () => pinElement('pin pin--them', themInitials));
    state.them?.getElement().classList.toggle('pin--stale', Boolean(them?.stale));

    // Reenquadra só quando aparece ou some um pin, para não tirar o mapa do lugar enquanto a pessoa o move.
    const fitKey = `${me ? 'm' : ''}${them ? 't' : ''}`;
    if (fitKey !== state.fitKey && fitKey !== '') {
      state.fitKey = fitKey;
      if (me && them) {
        const bounds = new lib.LngLatBounds([me.lng, me.lat], [me.lng, me.lat]);
        bounds.extend([them.lng, them.lat]);
        map.fitBounds(bounds, { padding: 64, maxZoom: 17, duration: 0 });
      } else {
        const only = (me ?? them) as MapPin;
        map.easeTo({ center: [only.lng, only.lat], zoom: 16, duration: 0 });
      }
    }
  }, [ready, me, them, themInitials]);

  return <div ref={box} className="matchmap" role="region" aria-label="Mapa com a posição de vocês dois" />;
}
