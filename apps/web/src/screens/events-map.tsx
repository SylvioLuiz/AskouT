import { OpenInMaps } from '../components/open-in-maps.tsx';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ExploreViews } from '../components/explore-views.tsx';
import { VenueLink } from '../components/venue-link.tsx';
import { VenueLogo } from '../components/venue-logo.tsx';
import { Button, EmptyState, Loading } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatDistance, formatTravel } from '../lib/flash.ts';
import { liveEvents, timeRange } from '../lib/live-events.ts';
import { Rating } from '../components/suggestions.tsx';
import { toApiError } from '../lib/errors.ts';
import type { ExploreEvent, ExplorePlace, ExploreRoute } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { t } from '../lib/i18n/index.ts';

const EventsMap = lazy(() => import('../components/events-map.tsx'));

const RADIUS_KM = 30;
const PLACES_RADIUS_KM = 10;

type Mode = 'places' | 'events';

function MapCard({ event, selected }: { event: ExploreEvent; selected: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <li className={`evmap__slide${selected ? ' evmap__slide--on' : ''}`} data-id={`e:${event.id}`}>
      <article className="evmapcard">
        <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evmapcard__link" aria-label={t('Abrir evento {title}', { title: event.title })}>
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

type RouteState = { key: string; mode: 'foot' | 'driving'; loading: boolean; data?: ExploreRoute; error?: string };

function PlaceCard({ place, selected, canRoute, route, onRoute, onClearRoute }: { place: ExplorePlace; selected: boolean; canRoute: boolean; route: RouteState | undefined; onRoute: (mode: 'foot' | 'driving') => void; onClearRoute: () => void }) {
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(place.venue?.logoUrl ?? null);

  // Local do AskouT abre direto; de fora (Google/OSM) ganha página na primeira vez.
  async function openPage() {
    setProblem(undefined);
    if (place.source === 'ASKOUT') {
      navigate(`/bares/${encodeURIComponent(place.key.replace(/^askout:/, ''))}`);
      return;
    }
    setOpening(true);
    try {
      const { venueId } = await api.openExternalVenue({ key: place.key, lat: place.lat, lng: place.lng });
      navigate(`/bares/${encodeURIComponent(venueId)}`);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setOpening(false);
    }
  }

  return (
    <li className={`evmap__slide${selected ? ' evmap__slide--on' : ''}`} data-id={`p:${place.key}`}>
      <article className="evmapcard evmapcard--place">
        <div className="evmapplace__head">
          {image ? (
            <img className="evmapplace__logo" src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
          ) : (
            <VenueLogo name={place.name} logoUrl={null} size={48} />
          )}
          <span className="evmapplace__info">
            <strong className="evmapplace__name">{place.name}</strong>
            <span className="evmapplace__line">
              {[place.category ?? 'Local', place.distanceM !== null ? `a ${formatDistance(place.distanceM)}` : null].filter(Boolean).join(' · ')}
            </span>
            {place.rating !== null ? <Rating rating={place.rating} count={place.ratingCount} /> : null}
          </span>
        </div>
        {place.sponsored ? <span className="tag-sponsored">{t('Patrocinado')}</span> : null}
        {problem ? <p className="field__error">{problem}</p> : null}
        <div className="evmapplace__actions">
          <Button small loading={opening} onClick={() => void openPage()}>
            {t('Ver página')}
          </Button>
          {canRoute ? (
            route ? (
              <Button small variant="quiet" onClick={onClearRoute}>
                {t('Tirar rota')}
              </Button>
            ) : (
              <Button small variant="secondary" onClick={() => onRoute('foot')}>
                {t('Rota')}
              </Button>
            )
          ) : (
            <OpenInMaps className="btn btn--quiet btn--small" mode="route" lat={place.lat} lng={place.lng} label={place.name}>
              {t('Rota')}
            </OpenInMaps>
          )}
        </div>
        {route ? (
          <div className="evmaproute">
            <div className="evmaproute__modes" role="radiogroup" aria-label={t('Como ir')}>
              <button type="button" role="radio" aria-checked={route.mode === 'foot'} aria-pressed={route.mode === 'foot'} className="chip" onClick={() => onRoute('foot')}>
                {t('A pé')}
              </button>
              <button type="button" role="radio" aria-checked={route.mode === 'driving'} aria-pressed={route.mode === 'driving'} className="chip" onClick={() => onRoute('driving')}>
                {t('De carro')}
              </button>
            </div>
            <p className="evmaproute__sum" role="status">
              {route.loading
                ? t('Traçando a rota…')
                : route.error
                  ? route.error
                  : route.data
                    ? `${formatDistance(route.data.distanceM)} · ${formatTravel(route.data.durationS)}${route.data.line === null ? ` ${t('(estimativa em linha reta)')}` : ''}`
                    : null}
            </p>
            <OpenInMaps className="btn btn--quiet btn--small" mode="route" lat={place.lat} lng={place.lng} label={place.name} travel={route.mode === 'driving' ? 'driving' : 'walking'}>
              {t('Abrir no app de mapas')}
            </OpenInMaps>
          </div>
        ) : null}
      </article>
    </li>
  );
}

/** Mapa em tela cheia com os locais perto e os eventos acontecendo agora; embaixo, o carrossel do que estiver escolhido. */
export function EventsMapScreen() {
  useTitle(t('Mapa do Explorar'));
  const where = useCurrentPosition();
  const waiting = where.status === 'asking';
  const position = where.position;
  const [mapFailed, setMapFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('places');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const strip = useRef<HTMLUListElement>(null);
  const scrolling = useRef(false);

  const eventsResult = useAsync<{ events: ExploreEvent[] } | null>(async () => {
    if (waiting) return null;
    const at = new Date();
    const r = await api.explore({
      lat: position?.lat,
      lng: position?.lng,
      radiusKm: position ? RADIUS_KM : undefined,
      from: at.toISOString(),
      to: new Date(at.getTime() + 60_000).toISOString(),
    });
    return { events: liveEvents(r.events, at) };
  }, [waiting, position?.lat, position?.lng]);

  const placesResult = useAsync<{ places: ExplorePlace[]; placesAvailable: boolean } | null>(async () => {
    if (waiting || !position) return null;
    return api.explorePlaces({ lat: position.lat, lng: position.lng, radiusKm: PLACES_RADIUS_KM });
  }, [waiting, position?.lat, position?.lng]);

  const events = useMemo(() => eventsResult.data?.events ?? [], [eventsResult.data]);
  const places = useMemo(() => placesResult.data?.places ?? [], [placesResult.data]);

  const pins = useMemo(
    () => [
      ...places.map((p) => ({ id: `p:${p.key}`, lat: p.lat, lng: p.lng, kind: 'place' as const, label: t('Ver {name}', { name: p.name }) })),
      ...events.map((e) => ({ id: `e:${e.id}`, lat: e.venue.lat, lng: e.venue.lng, kind: 'event' as const, label: t('Ver evento {title}', { title: e.title }) })),
    ],
    [places, events],
  );

  const ids = useMemo(() => (mode === 'places' ? places.map((p) => `p:${p.key}`) : events.map((e) => `e:${e.id}`)), [mode, places, events]);
  const current = selectedId && ids.includes(selectedId) ? selectedId : ids[0];

  // Pin tocado → troca para a lista do tipo dele e leva o carrossel até o cartão.
  function pick(id: string) {
    const nextMode: Mode = id.startsWith('p:') ? 'places' : 'events';
    setMode(nextMode);
    setSelectedId(id);
    const scrollTo = () => {
      const el = strip.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      if (!el) return;
      scrolling.current = true;
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      window.setTimeout(() => {
        scrolling.current = false;
      }, 500);
    };
    if (nextMode === mode) scrollTo();
    else window.setTimeout(scrollTo, 60);
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
  }, [ids.length, mode]);

  // Rota dentro do mapa, da sua posição até o local escolhido.
  const [route, setRoute] = useState<RouteState | undefined>();
  const routeSeq = useRef(0);
  async function showRoute(place: ExplorePlace, travel: 'foot' | 'driving') {
    if (!position) return;
    const seq = ++routeSeq.current;
    setRoute((cur) => ({ key: place.key, mode: travel, loading: true, ...(cur?.key === place.key && cur.data ? { data: cur.data } : {}) }));
    try {
      const data = await api.exploreRoute(position, { lat: place.lat, lng: place.lng }, travel);
      if (seq === routeSeq.current) setRoute({ key: place.key, mode: travel, loading: false, data });
    } catch (failure) {
      if (seq === routeSeq.current) setRoute({ key: place.key, mode: travel, loading: false, error: toApiError(failure).message });
    }
  }
  const routePlace = route ? places.find((p) => p.key === route.key) : undefined;
  const routeLine = useMemo(() => {
    if (!route?.data || !routePlace || !position) return undefined;
    const points = route.data.line ? route.data.line.map(([lng, lat]) => ({ lat, lng })) : [position, { lat: routePlace.lat, lng: routePlace.lng }];
    return { points, dashed: route.data.line === null };
  }, [route?.data, routePlace, position?.lat, position?.lng]);

  const active = mode === 'places' ? placesResult : eventsResult;
  const loading = waiting || (active.loading && !active.data);
  const noLocation = mode === 'places' && !position && !waiting;

  return (
    <div className="evmap">
      {mapFailed ? (
        <div className="evmap__canvas evmap__canvas--off">
          <EmptyState title={t('Não foi possível carregar o mapa')}>{t('Confira a conexão e tente de novo. Os locais e eventos continuam na lista do Explorar.')}</EmptyState>
        </div>
      ) : (
        <Suspense fallback={<div className="evmap__canvas" />}>
          <EventsMap pins={pins} me={position} selectedId={current} onSelect={pick} onFail={() => setMapFailed(true)} route={routeLine} />
        </Suspense>
      )}
      <header className="evmap__top">
        <ExploreViews current="map" floating />
        <div className="evmap__seg" role="group" aria-label={t('O que mostrar no carrossel')}>
          <button type="button" aria-pressed={mode === 'places'} className={mode === 'places' ? 'is-on' : ''} onClick={() => setMode('places')}>
            Locais{placesResult.data ? ` ${places.length}` : ''}
          </button>
          <button type="button" aria-pressed={mode === 'events'} className={mode === 'events' ? 'is-on' : ''} onClick={() => setMode('events')}>
            Acontecendo agora{eventsResult.data ? ` ${events.length}` : ''}
          </button>
        </div>
      </header>
      <section className="evmap__bottom" aria-label={mode === 'places' ? t('Locais mais próximos') : t('Eventos mais próximos')}>
        {noLocation ? (
          <div className="evmap__status">
            <p>{t('Ative a localização para ver os locais perto de você.')}</p>
            <Button small variant="secondary" onClick={() => setMode('events')}>
              {t('Ver eventos de agora')}
            </Button>
          </div>
        ) : loading ? (
          <div className="evmap__status">
            <Loading />
          </div>
        ) : active.error ? (
          <div className="evmap__status">
            <p>{active.error.message}</p>
            <Button small onClick={active.reload}>
              {t('Tentar de novo')}
            </Button>
          </div>
        ) : ids.length === 0 ? (
          <div className="evmap__status">
            {mode === 'places' ? (
              <p>{placesResult.data?.placesAvailable === false ? t('A busca de locais de fora está indisponível agora.') : t('Nenhum local encontrado por perto.')}</p>
            ) : (
              <p>Nenhum evento acontecendo agora{position ? ' por perto' : ''}.</p>
            )}
            {mode === 'events' ? (
              <Button small variant="secondary" onClick={() => navigate('/explorar')}>
                {t('Ver eventos de hoje')}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul ref={strip} key={mode} className="evmap__strip">
            {mode === 'places'
              ? places.map((p) => (
                  <PlaceCard
                    key={p.key}
                    place={p}
                    selected={`p:${p.key}` === current}
                    canRoute={position !== undefined}
                    route={route?.key === p.key ? route : undefined}
                    onRoute={(travel) => void showRoute(p, travel)}
                    onClearRoute={() => {
                      routeSeq.current += 1;
                      setRoute(undefined);
                    }}
                  />
                ))
              : events.map((e) => <MapCard key={e.id} event={e} selected={`e:${e.id}` === current} />)}
          </ul>
        )}
        {where.status === 'denied' || where.status === 'unavailable' ? <p className="evmap__note">{t('Sem a sua localização, os eventos não estão ordenados por distância.')}</p> : null}
      </section>
    </div>
  );
}
