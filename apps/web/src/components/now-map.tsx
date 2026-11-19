import { useEffect, useRef, useState } from 'react';
import { createMapEngine, type EngineMarker, type MapEngine, type LatLng } from './map-engine.ts';
import { t } from '../lib/i18n/index.ts';

// Mapa "Amigos livres no mapa" do NOW. Carregado sob demanda (a biblioteca é grande).
// Quem aceitou sair com você aparece no ponto exato; os outros só dentro de um círculo da região aproximada (~3 km).

export interface NowPin extends LatLng {
  id: string;
  name: string;
  /** Endereço da foto; sem ela, as iniciais. */
  photo: string | null;
  initials: string;
  exact: boolean;
  /** Texto embaixo do pin, ex.: "julia · ~2 km". */
  label: string;
}

interface Props {
  me: LatLng | undefined;
  pins: readonly NowPin[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  onFail: () => void;
}

function pinElement(pin: NowPin): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `nowpin${pin.exact ? ' nowpin--exact' : ' nowpin--approx'}`;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', pin.exact ? t('{name}, localização exata', { name: pin.name }) : t('{name}, região aproximada', { name: pin.name }));
  el.tabIndex = 0;
  if (!pin.exact) {
    const area = document.createElement('span');
    area.className = 'nowpin__area';
    el.appendChild(area);
  }
  const face = document.createElement(pin.photo ? 'img' : 'span');
  face.className = 'nowpin__face';
  if (pin.photo && face instanceof HTMLImageElement) {
    face.src = pin.photo;
    face.alt = '';
    face.referrerPolicy = 'no-referrer';
  } else face.textContent = pin.initials;
  el.appendChild(face);
  const label = document.createElement('span');
  label.className = 'nowpin__label';
  label.textContent = pin.label;
  el.appendChild(label);
  return el;
}

export default function NowMap({ me, pins, selected, onSelect, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: MapEngine; me?: EngineMarker; pins: Map<string, EngineMarker>; fitKey: string } | undefined>(undefined);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!box.current) return;
        const map = await createMapEngine(box.current, { center: me ?? pins[0] ?? { lat: -23.5505, lng: -46.6333 }, zoom: 13, onFail: () => failRef.current() });
        if (cancelled) {
          map.destroy();
          return;
        }
        live.current = { map, pins: new Map(), fitKey: '' };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      el.className = 'pin pin--me';
      el.setAttribute('aria-label', t('Você'));
      state.me = map.addMarker(el, me, 'center');
    }

    const wanted = new Set(pins.map((p) => p.id));
    for (const [id, marker] of state.pins) {
      if (!wanted.has(id)) {
        marker.remove();
        state.pins.delete(id);
      }
    }
    for (const pin of pins) {
      let marker = state.pins.get(pin.id);
      // Mudou de aproximado para exato (aceitou o convite): recria o pin.
      if (marker && marker.element.classList.contains('nowpin--exact') !== pin.exact) {
        marker.remove();
        marker = undefined;
      }
      if (marker) marker.setPosition(pin);
      else {
        const el = pinElement(pin);
        const pick = (event: Event) => {
          event.stopPropagation();
          selectRef.current(pin.id);
        };
        el.addEventListener('click', pick);
        el.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') pick(event);
        });
        marker = map.addMarker(el, pin, 'center');
        state.pins.set(pin.id, marker);
      }
    }

    const fitKey = `${me ? 'm' : ''}|${[...wanted].sort().join(',')}`;
    if (fitKey !== state.fitKey && fitKey !== '|') {
      state.fitKey = fitKey;
      const points: LatLng[] = [...(me ? [me] : []), ...pins];
      const first = points[0] as LatLng;
      if (points.length === 1) map.moveTo(first, { zoom: 13 });
      else map.fit(points, { top: 70, right: 50, bottom: 200, left: 50 }, 15);
    }
  }, [ready, me, pins]);

  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    for (const [id, marker] of state.pins) marker.element.classList.toggle('nowpin--selected', id === selected);
    const pin = pins.find((p) => p.id === selected);
    if (pin) state.map.moveTo(pin, { raiseBy: 90, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected]);

  return <div ref={box} className="matchmap nowmap" role="region" aria-label={t('Mapa com os amigos livres agora')} onClick={() => selectRef.current(undefined)} />;
}
