import { useEffect, useRef, useState } from 'react';
import { createMapEngine, type EngineMarker, type MapEngine, type MapLine } from './map-engine.ts';
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

function pinElement(className: string, text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

export default function MatchMap({ me, others, places = [], selectedKey, onPick, destination, routes, onFail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ map: MapEngine; me?: EngineMarker; others: Map<string, EngineMarker>; places: Map<string, EngineMarker>; dest?: EngineMarker; fitKey: string } | undefined>(undefined);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
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
        live.current = { map, others: new Map(), places: new Map(), fitKey: '' };
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

  // Lugares sugeridos: pins numerados; o selecionado fica em destaque.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map } = state;
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
        marker = map.addMarker(el, place, 'center');
        state.places.set(place.key, marker);
      }
      marker.element.classList.toggle('pin--selected', place.key === selectedKey);
    });
  }, [ready, places, selectedKey]);

  // Lugar escolhido pelos dois.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    const { map } = state;
    if (!destination) {
      state.dest?.remove();
      state.dest = undefined;
      return;
    }
    if (state.dest) state.dest.setPosition(destination);
    else {
      const el = pinElement('pin pin--dest', '★');
      el.setAttribute('aria-label', destination.name);
      state.dest = map.addMarker(el, destination, 'center');
    }
  }, [ready, destination]);

  // Rota de cada um até o lugar: trajeto de verdade, ou linha reta tracejada se não houver.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state) return;
    // As cores das rotas vêm dos mesmos tokens da legenda (você = marca, a outra pessoa = aviso).
    const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const lines: MapLine[] = [];
    if (destination) {
      for (const [who, route] of [['me', routes?.me], ['them', routes?.them]] as const) {
        if (!route) continue;
        const points = route.line ? route.line.map(([lng, lat]) => ({ lat, lng })) : [route.from, destination];
        lines.push({ points, color: who === 'me' ? css('--brand', 'blue') : css('--warn', 'orange'), dashed: route.line === null });
      }
    }
    state.map.setLines(lines);
  }, [ready, destination, routes]);

  // Ao escolher o lugar, enquadra os dois e o destino.
  useEffect(() => {
    const state = live.current;
    if (!ready || !state || !destination) return;
    const key = `${destination.lat},${destination.lng}`;
    if (state.fitKey.endsWith(`>${key}`)) return;
    state.fitKey = `${state.fitKey.split('>')[0] ?? ''}>${key}`;
    const points: MapPin[] = [destination, ...(me ? [me] : []), ...others];
    state.map.fit(points, 64, 17, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, destination]);

  return <div ref={box} className="matchmap" role="region" aria-label={t('Mapa com a posição de vocês dois')} />;
}
