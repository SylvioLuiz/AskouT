import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeftIcon } from '../components/icons.tsx';
import { VenueLink } from '../components/venue-link.tsx';
import { VenueLogo } from '../components/venue-logo.tsx';
import { Button, EmptyState, Loading } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { liveEvents, timeRange } from '../lib/live-events.ts';
import type { ExploreEvent } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';

const EventsMap = lazy(() => import('../components/events-map.tsx'));

const RADIUS_KM = 30;

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate('/explorar');
}

function MapCard({ event, selected }: { event: ExploreEvent; selected: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <li className={`evmap__slide${selected ? ' evmap__slide--on' : ''}`} data-id={event.id}>
      <article className="evmapcard">
        <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evmapcard__link" aria-label={`Abrir evento ${event.title}`}>
          <span className={`evmapcard__cover evcover--${event.kind.toLowerCase()}`}>
            {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null}
            <span className="evmapcard__shade" />
            <strong className="evmapcard__title">{event.title}</strong>
          </span>
        </Link>
        <div className="evmapcard__bar">
          <span className="evmapcard__venue">
            <VenueLogo name={event.venue.name} logoUrl={event.venue.logoUrl} size={32} />
            <VenueLink venueId={event.venue.id} name={event.venue.name} />
          </span>
          <span className="evmapcard__facts">
            <span>{timeRange(event.startsAt, event.endsAt)}</span>
            {event.distanceM !== null ? <span>a {formatDistance(event.distanceM)}</span> : null}
            <span>{kindLabel(event.kind)}</span>
          </span>
        </div>
      </article>
    </li>
  );
}

/** Mapa em tela cheia com os eventos que estão acontecendo agora; embaixo, o carrossel dos mais próximos. */
export function EventsMapScreen() {
  useTitle('Mapa de eventos');
  const where = useCurrentPosition();
  const waiting = where.status === 'asking';
  const position = where.position;
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const strip = useRef<HTMLUListElement>(null);
  const scrolling = useRef(false);

  const result = useAsync<{ events: ExploreEvent[]; at: Date } | null>(async () => {
    if (waiting) return null;
    const at = new Date();
    const r = await api.explore({
      lat: position?.lat,
      lng: position?.lng,
      radiusKm: position ? RADIUS_KM : undefined,
      from: at.toISOString(),
      to: new Date(at.getTime() + 60_000).toISOString(),
    });
    return { events: liveEvents(r.events, at), at };
  }, [waiting, position?.lat, position?.lng]);

  const events = result.data?.events ?? [];
  const pins = useMemo(() => events.map((e) => ({ id: e.id, lat: e.venue.lat, lng: e.venue.lng, kind: e.kind })), [events]);
  const current = selectedId && events.some((e) => e.id === selectedId) ? selectedId : events[0]?.id;

  // Pin tocado → leva o carrossel até o cartão.
  function pick(id: string) {
    setSelectedId(id);
    const el = strip.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (el) {
      scrolling.current = true;
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      window.setTimeout(() => {
        scrolling.current = false;
      }, 500);
    }
  }

  // Carrossel rolado à mão → o cartão mais ao centro vira o escolhido.
  useEffect(() => {
    const list = strip.current;
    if (!list) return;
    let timer: number | undefined;
    const onScroll = () => {
      if (scrolling.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const mid = list.getBoundingClientRect().left + list.clientWidth / 2;
        let best: { id: string; d: number } | undefined;
        for (const item of list.querySelectorAll<HTMLElement>('[data-id]')) {
          const r = item.getBoundingClientRect();
          const d = Math.abs(r.left + r.width / 2 - mid);
          if (!best || d < best.d) best = { id: item.dataset['id'] ?? '', d };
        }
        if (best?.id) setSelectedId(best.id);
      }, 80);
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      list.removeEventListener('scroll', onScroll);
    };
  }, [events.length]);

  const loading = waiting || (result.loading && !result.data);

  return (
    <div className="evmap">
      {mapFailed ? (
        <div className="evmap__canvas evmap__canvas--off">
          <EmptyState title="Não foi possível carregar o mapa">Confira a conexão e tente de novo. Os eventos continuam na lista do Explorar.</EmptyState>
        </div>
      ) : (
        <Suspense fallback={<div className="evmap__canvas" />}>
          <EventsMap pins={pins} me={position} selectedId={current} onSelect={pick} onFail={() => setMapFailed(true)} />
        </Suspense>
      )}
      <header className="evmap__top">
        <button type="button" className="evmap__back" onClick={goBack} aria-label="Voltar para o Explorar">
          <ChevronLeftIcon />
        </button>
        <h1 className="evmap__title">Acontecendo agora</h1>
        {!loading && !result.error ? <span className="evmap__count">{events.length}</span> : null}
      </header>
      <section className="evmap__bottom" aria-label="Eventos mais próximos">
        {loading ? (
          <div className="evmap__status">
            <Loading />
          </div>
        ) : result.error ? (
          <div className="evmap__status">
            <p>{result.error.message}</p>
            <Button small onClick={result.reload}>
              Tentar de novo
            </Button>
          </div>
        ) : events.length === 0 ? (
          <div className="evmap__status">
            <p>Nenhum evento acontecendo agora{position ? ' por perto' : ''}.</p>
            <Button small variant="secondary" onClick={() => navigate('/explorar')}>
              Ver eventos de hoje
            </Button>
          </div>
        ) : (
          <ul ref={strip} className="evmap__strip">
            {events.map((e) => (
              <MapCard key={e.id} event={e} selected={e.id === current} />
            ))}
          </ul>
        )}
        {where.status === 'denied' || where.status === 'unavailable' ? <p className="evmap__note">Sem a sua localização, os eventos não estão ordenados por distância.</p> : null}
      </section>
    </div>
  );
}
