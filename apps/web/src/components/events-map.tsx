import { useEffect, useRef, useState } from 'react';
import { createMapEngine, type EngineMarker, type MapEngine, type MapView } from './map-engine.ts';
import { t } from '../lib/i18n/index.ts';

// Mapa do Explorar: locais e eventos acontecendo agora. Google Maps (ou MapLibre sem a chave, ver map-engine.ts), carregado sob demanda.

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
  /** Falso depois que a pessoa escolhe uma área ou centraliza em si: o mapa fica onde ela deixou, como no Google Maps. */
  autoFit: boolean;
  /** A pessoa arrastou ou deu zoom e o mapa parou: a área visível agora. */
  onUserMove: (view: MapView) => void;
  /** Muda a cada toque em "Centralizar na minha localização": leva o mapa até a sua posição. */
  recenter: number;
  /** Falso logo depois de centralizar em você: o mapa não corre para o cartão destacado até a pessoa escolher outro. */
  followSelection: boolean;
}

export default function EventsMap({ pins, me, selectedId, onSelect, onFail, autoFit, onUserMove, recenter, followSelection }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: MapEngine; markers: Map<string, EngineMarker>; me?: EngineMarker; fitKey: string } | undefined>(undefined);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const moveRef = useRef(onUserMove);
  moveRef.current = onUserMove;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!box.current) return;
        const map = await createMapEngine(box.current, { center: { lat: -23.5505, lng: -46.6333 }, zoom: 13, onFail: () => failRef.current() });
        if (cancelled) {
          map.destroy();
          return;
        }
        live.current = { map, markers: new Map(), fitKey: '' };
        map.onUserMove((view) => moveRef.current(view));
        setReady(true);
      } catch {
        if (!cancelled) failRef.current();
      }
    })();
    return () => {
      cancelled = true;
      live.current?.map.destroy();
      live.current = undefined;
    };
  }, []);

  // Pins dos eventos e o seu.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map } = state;
    if (!me) {
      state.me?.remove();
      state.me = undefined;
    } else if (state.me) state.me.setPosition(me);
    else {
      const el = document.createElement('div');
      el.className = 'evpin evpin--me';
      state.me = map.addMarker(el, me, 'center');
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
        marker.setPosition(pin);
        marker.element.setAttribute('aria-label', pin.label);
      } else {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `evpin evpin--${pin.kind}`;
        el.setAttribute('aria-label', pin.label);
        el.dataset['id'] = pin.id;
        el.addEventListener('click', () => selectRef.current(pin.id));
        marker = map.addMarker(el, pin, 'bottom');
        state.markers.set(pin.id, marker);
      }
    }
    // Enquadra tudo só quando a lista de pins muda.
    const fitKey = pins.map((p) => p.id).sort().join(',');
    if (!autoFit) state.fitKey = fitKey;
    else if (fitKey !== state.fitKey && pins.length > 0) {
      state.fitKey = fitKey;
      const first = pins[0]!;
      if (pins.length === 1) map.moveTo(first, { zoom: 15 });
      else map.fit(pins, { top: 80, bottom: 300, left: 40, right: 40 }, 15);
    } else if (pins.length === 0 && me && state.fitKey !== 'me') {
      state.fitKey = 'me';
      map.moveTo(me, { zoom: 14 });
    }
  }, [ready, pins, me, autoFit]);

  // Destaque do pin escolhido e deslocamento do mapa até ele.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    for (const [id, marker] of state.markers) marker.element.classList.toggle('evpin--on', id === selectedId);
    const pin = pins.find((p) => p.id === selectedId);
    if (pin && followSelection) state.map.moveTo(pin, { raiseBy: 90, animate: true });
  }, [ready, selectedId, pins, followSelection]);

  // "Centralizar na minha localização". Só no toque do botão, não a cada atualização da posição.
  const meRef = useRef(me);
  meRef.current = me;
  useEffect(() => {
    const state = live.current;
    const at = meRef.current;
    if (!ready || !state || !at || recenter === 0) return;
    state.map.moveTo(at, { zoom: 15, raiseBy: 90, animate: true });
  }, [ready, recenter]);

  return <div ref={box} className="evmap__canvas" role="region" aria-label={t('Mapa com os locais e eventos perto')} />;
}
