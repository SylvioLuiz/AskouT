import { useEffect, useRef, useState } from 'react';
import { createMapEngine, type EngineMarker, type MapEngine } from './map-engine.ts';
import { t } from '../lib/i18n/index.ts';

// Mapa do encontro: Google Maps (ou MapLibre sem a chave, ver map-engine.ts). Carregado sob demanda, só na tela
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

function pinElement(className: string, text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

export default function MatchMap({ me, others, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: MapEngine; me?: EngineMarker; others: Map<string, EngineMarker>; fitKey: string } | undefined>(undefined);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!box.current) return;
        const map = await createMapEngine(box.current, { center: { lat: -23.5505, lng: -46.6333 }, zoom: 14, onFail: () => failRef.current() });
        if (cancelled) {
          map.destroy();
          return;
        }
        live.current = { map, others: new Map(), fitKey: '' };
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

  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map } = state;

    // Seu pin.
    if (!me) {
      state.me?.remove();
      state.me = undefined;
    } else if (state.me) state.me.setPosition(me);
    else state.me = map.addMarker(pinElement('pin pin--me', ''), me, 'center');

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
      if (marker) marker.setPosition(other);
      else {
        marker = map.addMarker(pinElement('pin pin--them', other.initials), other, 'center');
        state.others.set(other.id, marker);
      }
      marker.element.classList.toggle('pin--stale', other.stale);
    }

    // Reenquadra só quando aparece ou some um pin, para não tirar o mapa do lugar enquanto a pessoa o move.
    const fitKey = `${me ? 'm' : ''}|${[...wanted].sort().join(',')}`;
    if (fitKey !== state.fitKey && fitKey !== '|') {
      state.fitKey = fitKey;
      const points: MapPin[] = [...(me ? [me] : []), ...others];
      const first = points[0] as MapPin;
      if (points.length === 1) map.moveTo(first, { zoom: 16 });
      else map.fit(points, 64, 17);
    }
  }, [ready, me, others]);

  return <div ref={box} className="matchmap" role="region" aria-label={t('Mapa com a posição de vocês dois')} />;
}
