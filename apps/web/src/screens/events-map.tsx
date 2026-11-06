import { OpenInMaps } from '../components/open-in-maps.tsx';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ExploreViews } from '../components/explore-views.tsx';
import { VenueLink } from '../components/venue-link.tsx';
import { VenueLogo } from '../components/venue-logo.tsx';
import { Button, EmptyState } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { distanceMeters, formatDistance } from '../lib/flash.ts';
import { liveEvents, timeRange } from '../lib/live-events.ts';
import { Rating } from '../components/suggestions.tsx';
import { toApiError } from '../lib/errors.ts';
import type { ExploreEvent, ExplorePlace } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { LocationIcon, RouteIcon, SearchIcon } from '../components/icons.tsx';
import type { MapView } from '../components/map-engine.ts';
import { t } from '../lib/i18n/index.ts';

const EventsMap = lazy(() => import('../components/events-map.tsx'));

const RADIUS_KM = 30;
const PLACES_RADIUS_KM = 10;
/** Limites do raio aceito pela API do Explorar. */
const MIN_AREA_KM = 1;
const MAX_AREA_KM = 100;

type Mode = 'places' | 'events';

/** Área escolhida com "Pesquisar nesta área": centro e raio da parte visível do mapa. */
interface Area {
  lat: number;
  lng: number;
  radiusKm: number;
}

function toArea(view: MapView): Area {
  const radiusKm = Math.min(MAX_AREA_KM, Math.max(MIN_AREA_KM, Math.round(view.radiusKm * 10) / 10));
  return { lat: view.center.lat, lng: view.center.lng, radiusKm };
}

/**
 * O mapa saiu da área já buscada? Mesmo critério do Google Maps: arrastou para longe,
 * afastou (área bem maior) ou aproximou bastante (área bem menor).
 */
function leftSearchedArea(view: MapView, searched: Area | undefined): boolean {
  if (!searched) return true;
  const offsetKm = distanceMeters(view.center, searched) / 1000;
  return offsetKm > searched.radiusKm * 0.35 || view.radiusKm > searched.radiusKm * 1.4 || view.radiusKm < searched.radiusKm * 0.4;
}

/** Quando a busca é de outra área, a distância mostrada continua sendo a partir de você. */
function distanceFromYou(from: { lat: number; lng: number } | undefined, to: { lat: number; lng: number }): number | null {
  return from ? distanceMeters(from, to) : null;
}

/** Imagem que aparece aos poucos depois de carregar, em vez de surgir de uma vez. */
function FadeImage({ className, src, onError }: { className?: string; src: string; onError: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={`${className ?? ''} fadeimg${loaded ? ' fadeimg--on' : ''}`.trim()}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
      onError={onError}
    />
  );
}

/** Esqueleto no formato dos cartões enquanto a primeira busca não volta: o rodapé já nasce na altura certa. */
function StripSkeleton({ mode }: { mode: Mode }) {
  return (
    <div className="evmap__strip evmap__strip--skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">{t('Carregando')}…</span>
      {[0, 1].map((i) => (
        <div key={i} className="evmap__slide" aria-hidden="true">
          {mode === 'places' ? (
            <div className="evmapcard evmapcard--place evmapcard--skeleton">
              <div className="evmapplace__head">
                <span className="evskel evskel--logo" />
                <span className="evmapplace__info evskel__lines">
                  <span className="evskel evskel--line" />
                  <span className="evskel evskel--line evskel--short" />
                </span>
              </div>
              <div className="evmapplace__actions">
                <span className="evskel evskel--button" />
                <span className="evskel evskel--button evskel--quiet" />
              </div>
            </div>
          ) : (
            <div className="evmapcard evmapcard--skeleton">
              <span className="evskel evskel--cover" />
              <div className="evmapcard__bar">
                <span className="evskel evskel--line" />
                <span className="evskel evskel--line evskel--short" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Os primeiros cartões entram um pouco depois do anterior; os de fora da tela, sem espera. */
function enterDelay(index: number): CSSProperties {
  return { animationDelay: `${Math.min(index, 3) * 50}ms` };
}

function MapCard({ event, selected, index }: { event: ExploreEvent; selected: boolean; index: number }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <li className={`evmap__slide${selected ? ' evmap__slide--on' : ''}`} data-id={`e:${event.id}`} style={enterDelay(index)}>
      <article className="evmapcard">
        <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evmapcard__link" aria-label={t('Abrir evento {title}', { title: event.title })}>
          <span className={`evmapcard__cover evcover--${event.kind.toLowerCase()}`}>
            {image ? <FadeImage src={image} onError={() => setFailed(true)} /> : null}
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

function PlaceCard({ place, selected, index }: { place: ExplorePlace; selected: boolean; index: number }) {
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
    <li className={`evmap__slide${selected ? ' evmap__slide--on' : ''}`} data-id={`p:${place.key}`} style={enterDelay(index)}>
      <article className="evmapcard evmapcard--place">
        <div className="evmapplace__head">
          {image ? (
            <FadeImage className="evmapplace__logo" src={image} onError={() => setFailed(true)} />
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
          <OpenInMaps className="btn btn--quiet btn--small evmapplace__route" mode="route" lat={place.lat} lng={place.lng} label={place.name}>
            <RouteIcon />
            {t('Rota')}
          </OpenInMaps>
        </div>
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
  // Área escolhida com "Pesquisar nesta área" (sem ela, a busca é em volta de você) e a área visível ainda não buscada.
  const [area, setArea] = useState<Area | undefined>();
  const [moved, setMoved] = useState<MapView | undefined>();
  // O mapa só se enquadra sozinho até a pessoa escolher uma área ou centralizar em si.
  const [manual, setManual] = useState(false);
  const [recenter, setRecenter] = useState(0);
  // Logo depois de "Centralizar na minha localização": o mapa fica em você até a pessoa escolher um cartão ou pin.
  const [atMe, setAtMe] = useState(false);
  const [meHint, setMeHint] = useState(0);
  useEffect(() => {
    if (meHint === 0) return;
    const timer = window.setTimeout(() => setMeHint(0), 2600);
    return () => window.clearTimeout(timer);
  }, [meHint]);

  const eventsResult = useAsync<{ events: ExploreEvent[] } | null>(async () => {
    if (waiting) return null;
    const at = new Date();
    const center = area ?? position;
    const r = await api.explore({
      lat: center?.lat,
      lng: center?.lng,
      radiusKm: area ? area.radiusKm : position ? RADIUS_KM : undefined,
      from: at.toISOString(),
      to: new Date(at.getTime() + 60_000).toISOString(),
    });
    const events = liveEvents(r.events, at);
    return { events: area ? events.map((e) => ({ ...e, distanceM: distanceFromYou(position, e.venue) })) : events };
  }, [waiting, position?.lat, position?.lng, area]);

  const placesResult = useAsync<{ places: ExplorePlace[]; placesAvailable: boolean } | null>(async () => {
    const center = area ?? position;
    if (waiting || !center) return null;
    const r = await api.explorePlaces({ lat: center.lat, lng: center.lng, radiusKm: area ? area.radiusKm : PLACES_RADIUS_KM });
    return area ? { ...r, places: r.places.map((p) => ({ ...p, distanceM: distanceFromYou(position, p) })) } : r;
  }, [waiting, position?.lat, position?.lng, area]);

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
    setAtMe(false);
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
        if (best?.id) {
          setAtMe(false);
          setSelectedId(best.id);
        }
      }, 80);
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      list.removeEventListener('scroll', onScroll);
    };
  }, [ids.length, mode]);

  const active = mode === 'places' ? placesResult : eventsResult;
  const loading = waiting || (active.loading && !active.data);
  const noLocation = mode === 'places' && !position && !area && !waiting;
  // Nova busca com cartões já na tela: eles ficam (esmaecidos) até os novos chegarem, sem o rodapé sumir e voltar.
  const refreshing = active.loading && !!active.data;

  // Área já buscada no modo atual, para saber se o mapa saiu dela.
  const searched: Area | undefined = area ?? (position ? { ...position, radiusKm: mode === 'places' ? PLACES_RADIUS_KM : RADIUS_KM } : undefined);
  const searchedRef = useRef(searched);
  searchedRef.current = searched;
  const onUserMove = useCallback((view: MapView) => {
    setMoved(leftSearchedArea(view, searchedRef.current) ? view : undefined);
  }, []);

  function searchHere() {
    if (!moved) return;
    setArea(toArea(moved));
    setManual(true);
    setMoved(undefined);
    setSelectedId(undefined);
  }

  // Volta para a busca em volta de você e leva o mapa até a sua posição.
  function centerOnMe() {
    setManual(true);
    setArea(undefined);
    setMoved(undefined);
    setSelectedId(undefined);
    setRecenter((n) => n + 1);
    setAtMe(true);
    setMeHint((n) => n + 1);
  }

  const searching = !!area && refreshing;
  const resultsKey = `${mode}:${area ? `${area.lat},${area.lng},${area.radiusKm}` : 'perto'}`;
  const count = ids.length;
  const resultsLabel =
    mode === 'places'
      ? count === 1
        ? t(area ? '1 local nesta área' : '1 local por perto')
        : t(area ? '{n} locais nesta área' : '{n} locais por perto', { n: count })
      : count === 1
        ? t(area ? '1 evento agora nesta área' : '1 evento agora')
        : t(area ? '{n} eventos agora nesta área' : '{n} eventos agora', { n: count });

  return (
    <div className="evmap">
      {mapFailed ? (
        <div className="evmap__canvas evmap__canvas--off">
          <EmptyState title={t('Não foi possível carregar o mapa')}>{t('Confira a conexão e tente de novo. Os locais e eventos continuam na lista do Explorar.')}</EmptyState>
        </div>
      ) : (
        <Suspense fallback={<div className="evmap__canvas" />}>
          <EventsMap
            pins={pins}
            me={position}
            selectedId={current}
            onSelect={pick}
            onFail={() => setMapFailed(true)}
            autoFit={!manual}
            onUserMove={onUserMove}
            recenter={recenter}
            followSelection={!atMe}
          />
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
        {meHint && !moved && !searching ? (
          <p key={meHint} className="evmap__hint" role="status">
            <LocationIcon />
            {t('Mostrando a sua localização')}
          </p>
        ) : null}
        {moved || searching ? (
          <button type="button" className="evmap__area" onClick={searchHere} disabled={searching} aria-busy={searching || undefined}>
            {searching ? <span className="evmap__spin" aria-hidden="true" /> : <SearchIcon />}
            {searching ? t('Buscando nesta área…') : t('Pesquisar nesta área')}
          </button>
        ) : null}
      </header>
      <section className="evmap__bottom" aria-label={mode === 'places' ? t('Locais mais próximos') : t('Eventos mais próximos')}>
        {position && !mapFailed ? (
          <button type="button" className="evmap__locate" onClick={centerOnMe} aria-label={t('Centralizar na minha localização')} title={t('Centralizar na minha localização')}>
            <LocationIcon />
          </button>
        ) : null}
        {noLocation ? (
          <div className="evmap__status">
            <p>{t('Ative a localização para ver os locais perto de você.')}</p>
            <Button small variant="secondary" onClick={() => setMode('events')}>
              {t('Ver eventos de agora')}
            </Button>
          </div>
        ) : loading ? (
          <StripSkeleton mode={mode} />
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
              <p>
                {placesResult.data?.placesAvailable === false
                  ? t('A busca de locais de fora está indisponível agora.')
                  : area
                    ? t('Nenhum local encontrado nesta área.')
                    : t('Nenhum local encontrado por perto.')}
              </p>
            ) : (
              <p>{area ? t('Nenhum evento acontecendo agora nesta área.') : `Nenhum evento acontecendo agora${position ? ' por perto' : ''}.`}</p>
            )}
            {mode === 'events' ? (
              <Button small variant="secondary" onClick={() => navigate('/explorar')}>
                {t('Ver eventos de hoje')}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="evmap__count" aria-live="polite">
              {resultsLabel}
            </p>
            <ul ref={strip} key={resultsKey} className={`evmap__strip${refreshing ? ' evmap__strip--stale' : ''}`} aria-busy={refreshing || undefined}>
              {mode === 'places'
                ? places.map((p, i) => <PlaceCard key={p.key} place={p} index={i} selected={`p:${p.key}` === current} />)
                : events.map((e, i) => <MapCard key={e.id} event={e} index={i} selected={`e:${e.id}` === current} />)}
            </ul>
          </>
        )}
        {where.status === 'denied' || where.status === 'unavailable' ? <p className="evmap__note">{t('Sem a sua localização, os eventos não estão ordenados por distância.')}</p> : null}
      </section>
    </div>
  );
}
