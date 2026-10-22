import { useEffect, useRef, useState } from 'react';
import type { Map as GlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Mapa do Explorar: locais e eventos acontecendo agora. Mapa-base do OpenStreetMap desenhado pelo MapLibre, carregado sob demanda.

export interface EventPin {
  id: string;
  lat: number;
  lng: number;
  /** Local (bar, casa…) ou evento acontecendo agora: cada um tem a sua cor. */
  kind: 'place' | 'event';
  label: string;
}

interface Props {
  pins: readonly EventPin[];
  me: { lat: number; lng: number } | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onFail: () => void;
}

const STYLE = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

// Em produção, aponte VITE_MAP_STYLE_URL para um estilo MapLibre (ex.: MapTiler, Stadia, Protomaps). Sem isso usa os blocos públicos do OSM, só para desenvolvimento.
const STYLE_URL = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim() || undefined;

type Lib = typeof import('maplibre-gl');

export default function EventsMap({ pins, me, selectedId, onSelect, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: GlMap; lib: Lib; markers: Map<string, Marker>; me?: Marker; fitKey: string } | undefined>(undefined);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await import('maplibre-gl');
        if (cancelled || !box.current) return;
        const map = new lib.Map({ container: box.current, style: STYLE_URL ?? STYLE, center: [-46.6333, -23.5505], zoom: 13, attributionControl: { compact: true } });
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        live.current = { map, lib, markers: new Map(), fitKey: '' };
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

  // Pins dos eventos e o seu.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map, lib } = state;
    if (!me) {
      state.me?.remove();
      state.me = undefined;
    } else if (state.me) state.me.setLngLat([me.lng, me.lat]);
    else {
      const el = document.createElement('div');
      el.className = 'evpin evpin--me';
      state.me = new lib.Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(map);
    }
    const wanted = new Set(pins.map((p) => p.id));
    for (const [id, marker] of state.markers) {
      if (!wanted.has(id)) {
        marker.remove();
        state.markers.delete(id);
      }
    }
    for (const pin of pins) {
      let marker = state.markers.get(pin.id);
      if (marker) {
        marker.setLngLat([pin.lng, pin.lat]);
        marker.getElement().setAttribute('aria-label', pin.label);
      } else {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `evpin evpin--${pin.kind}`;
        el.setAttribute('aria-label', pin.label);
        el.dataset['id'] = pin.id;
        el.addEventListener('click', () => selectRef.current(pin.id));
        marker = new lib.Marker({ element: el, anchor: 'bottom' }).setLngLat([pin.lng, pin.lat]).addTo(map);
        state.markers.set(pin.id, marker);
      }
    }
    // Enquadra tudo só quando a lista de pins muda.
    const fitKey = pins.map((p) => p.id).sort().join(',');
    if (fitKey !== state.fitKey && pins.length > 0) {
      state.fitKey = fitKey;
      const first = pins[0]!;
      if (pins.length === 1) map.easeTo({ center: [first.lng, first.lat], zoom: 15, duration: 0 });
      else {
        const bounds = new lib.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
        for (const p of pins) bounds.extend([p.lng, p.lat]);
        map.fitBounds(bounds, { padding: { top: 80, bottom: 300, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
      }
    } else if (pins.length === 0 && me && state.fitKey !== 'me') {
      state.fitKey = 'me';
      map.easeTo({ center: [me.lng, me.lat], zoom: 14, duration: 0 });
    }
  }, [ready, pins, me]);

  // Destaque do pin escolhido e deslocamento do mapa até ele.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    for (const [id, marker] of state.markers) marker.getElement().classList.toggle('evpin--on', id === selectedId);
    const pin = pins.find((p) => p.id === selectedId);
    if (pin) state.map.easeTo({ center: [pin.lng, pin.lat], offset: [0, -90], duration: 350 });
  }, [ready, selectedId, pins]);

  return <div ref={box} className="evmap__canvas" role="region" aria-label="Mapa com os locais e eventos perto" />;
}
