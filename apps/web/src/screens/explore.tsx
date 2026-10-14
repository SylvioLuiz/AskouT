import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { SearchIcon } from '../components/icons.tsx';
import { PlacePhoto, Rating, SampleBadge } from '../components/suggestions.tsx';
import { Button, EmptyState, ErrorState, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { formatWhen, mapLink, routeLink } from '../lib/chat.ts';
import {
  KINDS,
  RADIUS_DEFAULT_KM,
  RADIUS_MAX_KM,
  RADIUS_MIN_KM,
  RANGES,
  activeFilterCount,
  coverShape,
  effectiveQuery,
  kindLabel,
  rangeFor,
  rangeLabel,
  safeImage,
  sourceName,
} from '../lib/explore.ts';
import type { RangeId } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { pluralize } from '../lib/format.ts';
import type { EventKind, ExploreEvent, ExplorePlace, ExploreResult } from '../lib/types.ts';
import { Link, navigate, useSearch } from '../router.tsx';

// ---------- Posição (só para esta consulta; nada é guardado no aparelho) ----------

type Position = { lat: number; lng: number };
type LocationState = { status: 'asking' | 'denied' | 'unavailable'; position?: undefined } | { status: 'ok'; position: Position };

let lastPosition: { position: Position; at: number } | undefined;
const POSITION_MAX_AGE_MS = 5 * 60_000;

/** Pede a posição ao abrir o Explorar. Só fica em memória nesta sessão da página. */
export function useCurrentPosition(): LocationState {
  const [state, setState] = useState<LocationState>(() =>
    lastPosition && Date.now() - lastPosition.at < POSITION_MAX_AGE_MS ? { status: 'ok', position: lastPosition.position } : { status: 'asking' },
  );
  useEffect(() => {
    if (state.status === 'ok') return;
    if (!('geolocation' in navigator)) {
      setState({ status: 'unavailable' });
      return;
    }
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const position = { lat: p.coords.latitude, lng: p.coords.longitude };
        lastPosition = { position, at: Date.now() };
        if (alive) setState({ status: 'ok', position });
      },
      (err) => {
        if (alive) setState({ status: err.code === 1 ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: POSITION_MAX_AGE_MS },
    );
    return () => {
      alive = false;
    };
    // Roda uma vez ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

// ---------- Peças de tela ----------

function EventCover({ event, shape }: { event: ExploreEvent; shape: string }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <div className={`evcover evcover--${shape} evcover--${event.kind.toLowerCase()}`}>
      {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="evcover__kind" aria-hidden="true">{kindLabel(event.kind)}</span>}
      <span className="evcover__tags">
        {event.isFree ? <span className="tag tag--free">Grátis</span> : null}
        {event.sample ? <SampleBadge /> : null}
      </span>
    </div>
  );
}

function EventCard({ event, now }: { event: ExploreEvent; now: Date }) {
  return (
    <li className="evcard">
      <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evcard__link">
        <EventCover event={event} shape={coverShape(event.id)} />
        <div className="evcard__body">
          <h3 className="evcard__title">{event.title}</h3>
          <p className="evcard__venue">{event.venue.name}</p>
          <p className="evcard__when">{formatWhen(event.startsAt, event.endsAt, now)}</p>
          {event.distanceM !== null ? <p className="evcard__dist">a {formatDistance(event.distanceM)}</p> : null}
        </div>
      </Link>
    </li>
  );
}

function PlaceRow({ place }: { place: ExplorePlace }) {
  return (
    <li className="placerow">
      {place.photoPath ? <PlacePhoto path={place.photoPath} author={place.photoAuthor} /> : null}
      <div className="sugcard__tags">
        <span className={`tag tag--${place.source === 'ASKOUT' ? 'event' : place.source === 'GOOGLE' ? 'google' : 'osm'}`}>{sourceName(place.source)}</span>
        {place.sample ? <SampleBadge /> : null}
      </div>
      <h3 className="placerow__name">{place.name}</h3>
      {place.address ? <p className="placerow__line">{place.address}</p> : null}
      {place.rating !== null ? <Rating rating={place.rating} count={place.ratingCount} /> : null}
      <p className="placerow__line">
        {place.category ? `${place.category}` : 'Local'}
        {place.distanceM !== null ? ` · a ${formatDistance(place.distanceM)}` : ''}
      </p>
      <div className="sugcard__actions">
        <a className="btn btn--quiet btn--small" href={routeLink(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
          Rota
        </a>
        <a className="btn btn--quiet btn--small" href={place.mapsUri ?? mapLink(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
          Mapa
        </a>
      </div>
    </li>
  );
}

type Tab = 'all' | 'events' | 'places' | 'people' | 'tags';

// ---------- Tela ----------

export function ExploreScreen() {
  useTitle('Explorar');
  const initialQuery = useSearch().get('q') ?? '';
  const [query, setQuery] = useState(initialQuery.slice(0, 80));
  const [range, setRange] = useState<RangeId>('today');
  const [kind, setKind] = useState<EventKind | null>(null);
  const [free, setFree] = useState(false);
  const [radiusKm, setRadiusKm] = useState(RADIUS_DEFAULT_KM);
  const [sheet, setSheet] = useState<'range' | 'kind' | 'radius' | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const where = useCurrentPosition();
  const q = effectiveQuery(useDebounced(query, 300));
  const position = where.position;
  const waiting = where.status === 'asking';

  const result = useAsync<ExploreResult | null>(async () => {
    if (waiting) return null;
    const { from, to } = rangeFor(range, new Date());
    return api.explore({
      q: q || undefined,
      lat: position?.lat,
      lng: position?.lng,
      radiusKm: position ? radiusKm : undefined,
      from: from.toISOString(),
      to: to.toISOString(),
      kind: kind ?? undefined,
      free,
    });
  }, [q, range, kind, free, radiusKm, position?.lat, position?.lng, waiting]);

  const data = result.data;
  const now = useMemo(() => new Date(), [data]);
  const searching = q !== '';
  const filters = activeFilterCount({ range, kind, free, radiusKm });

  function clearFilters() {
    setRange('today');
    setKind(null);
    setFree(false);
    setRadiusKm(RADIUS_DEFAULT_KM);
  }

  function searchTag(tag: string) {
    setQuery(`#${tag}`);
    setTab('events');
    inputRef.current?.focus();
  }

  const counts = data ? { events: data.events.length, places: data.places.length, people: data.people.length, tags: data.tags.length } : null;
  const tabs: { id: Tab; label: string; n: number | null }[] = [
    { id: 'all', label: 'Tudo', n: null },
    { id: 'events', label: 'Eventos', n: counts?.events ?? null },
    { id: 'places', label: 'Locais', n: counts?.places ?? null },
    { id: 'people', label: 'Pessoas', n: counts?.people ?? null },
    { id: 'tags', label: '#', n: counts?.tags ?? null },
  ];
  const show = (section: Exclude<Tab, 'all'>) => tab === 'all' || tab === section;
  const nothing = data && data.events.length + data.places.length + data.people.length + data.tags.length === 0;

  return (
    <>
      <PageHead title="Explorar" />

      <div className="search search--explore" role="search">
        <span className="search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <label className="visually-hidden" htmlFor="busca">
          Buscar eventos, bares, pessoas ou #
        </label>
        <input
          id="busca"
          ref={inputRef}
          className="search__input search__input--icon"
          type="search"
          placeholder="Eventos, bares, pessoas ou #"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={80}
        />
      </div>

      <div className="filters" role="group" aria-label="Filtros">
        <button type="button" className={`fchip${range !== 'today' ? ' fchip--on' : ''}`} onClick={() => setSheet('range')} aria-haspopup="dialog">
          {rangeLabel(range)} <span aria-hidden="true">▾</span>
        </button>
        <button type="button" className={`fchip${kind ? ' fchip--on' : ''}`} onClick={() => setSheet('kind')} aria-haspopup="dialog">
          {kind ? kindLabel(kind) : 'Tipo de evento'} <span aria-hidden="true">▾</span>
        </button>
        <button type="button" className={`fchip${free ? ' fchip--on' : ''}`} aria-pressed={free} onClick={() => setFree((v) => !v)}>
          Grátis
        </button>
        <button type="button" className={`fchip${radiusKm !== RADIUS_DEFAULT_KM ? ' fchip--on' : ''}`} onClick={() => setSheet('radius')} aria-haspopup="dialog" disabled={!position}>
          Raio {radiusKm} km <span aria-hidden="true">▾</span>
        </button>
        {filters > 0 ? (
          <button type="button" className="fchip fchip--clear" onClick={clearFilters}>
            Limpar
          </button>
        ) : null}
      </div>

      {where.status === 'denied' || where.status === 'unavailable' ? (
        <p className="muted explore__note">
          {where.status === 'denied'
            ? 'Sem a sua localização não dá para mostrar o que está perto. Os eventos aparecem sem distância; libere a localização nas configurações do navegador.'
            : 'Não foi possível pegar a sua localização. Os eventos aparecem sem distância.'}
        </p>
      ) : null}

      {searching ? (
        <div className="segtabs" role="tablist" aria-label="Resultados">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
              {t.label}
              {t.n !== null ? <span className="segtabs__n">{t.n}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {waiting || result.loading ? <Loading label={waiting ? 'Buscando a sua localização' : 'Buscando'} /> : null}
      {!waiting && result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}

      {!waiting && !result.loading && data ? (
        <>
          {!searching ? (
            data.events.length === 0 ? (
              <EmptyState
                title="Nenhum evento por aqui"
                action={
                  filters > 0 || range !== 'any' ? (
                    <Button small variant="secondary" onClick={() => (filters > 0 ? clearFilters() : setRange('any'))}>
                      {filters > 0 ? 'Limpar filtros' : 'Ver os próximos 30 dias'}
                    </Button>
                  ) : undefined
                }
              >
                Ainda não há eventos cadastrados {data.located ? `a até ${data.radiusKm} km ` : ''}neste período. Busque por um bar, uma pessoa ou uma #.
              </EmptyState>
            ) : (
              <>
                <p className="muted" aria-live="polite">
                  {pluralize(data.events.length, 'evento', 'eventos')} {data.located ? `a até ${data.radiusKm} km` : 'no período'}
                </p>
                <ul className="evgrid">
                  {data.events.map((e) => (
                    <EventCard key={e.id} event={e} now={now} />
                  ))}
                </ul>
              </>
            )
          ) : nothing ? (
            <EmptyState title="Nada encontrado">
              {q.startsWith('#') ? 'Nenhum evento com essa #.' : 'Confira o que digitou ou aumente o raio. Lugares de fora só aparecem com a sua localização liberada.'}
            </EmptyState>
          ) : (
            <div className="results">
              {show('tags') && data.tags.length > 0 ? (
                <section aria-label="Hashtags">
                  <h2 className="results__h">Hashtags</h2>
                  <ul className="tagchips">
                    {data.tags.map((t) => (
                      <li key={t.tag}>
                        <button type="button" className="fchip" onClick={() => searchTag(t.tag)}>
                          #{t.tag} <span className="segtabs__n">{t.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {show('events') && data.events.length > 0 ? (
                <section aria-label="Eventos">
                  <h2 className="results__h">Eventos</h2>
                  <ul className="evgrid">
                    {data.events.map((e) => (
                      <EventCard key={e.id} event={e} now={now} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {show('places') && data.places.length > 0 ? (
                <section aria-label="Locais">
                  <h2 className="results__h">Bares e locais</h2>
                  <ul className="placelist">
                    {data.places.map((p) => (
                      <PlaceRow key={p.key} place={p} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {show('places') && !data.placesAvailable ? <p className="muted">A fonte de lugares de fora não respondeu agora. Os locais do AskouT aparecem normalmente.</p> : null}
              {show('people') && data.people.length > 0 ? (
                <section aria-label="Pessoas">
                  <h2 className="results__h">Pessoas</h2>
                  <ul className="list">
                    {data.people.map((profile) => (
                      <PersonRow key={profile.userId} profile={profile} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {sheet === 'range' ? (
        <Sheet title="Quando" onClose={() => setSheet(null)}>
          <ul className="optlist">
            {RANGES.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="optlist__item"
                  aria-pressed={range === r.id}
                  onClick={() => {
                    setRange(r.id);
                    setSheet(null);
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}

      {sheet === 'kind' ? (
        <Sheet title="Tipo de evento" onClose={() => setSheet(null)}>
          <ul className="optlist">
            <li>
              <button
                type="button"
                className="optlist__item"
                aria-pressed={kind === null}
                onClick={() => {
                  setKind(null);
                  setSheet(null);
                }}
              >
                Todos os tipos
              </button>
            </li>
            {KINDS.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  className="optlist__item"
                  aria-pressed={kind === k.id}
                  onClick={() => {
                    setKind(k.id);
                    setSheet(null);
                  }}
                >
                  {k.label}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}

      {sheet === 'radius' ? (
        <Sheet title="Raio" onClose={() => setSheet(null)}>
          <label className="radius" htmlFor="raio">
            <span className="radius__value">{radiusKm} km</span>
            <input id="raio" type="range" min={RADIUS_MIN_KM} max={RADIUS_MAX_KM} step={1} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} />
            <span className="radius__scale">
              <span>{RADIUS_MIN_KM} km</span>
              <span>{RADIUS_MAX_KM} km</span>
            </span>
          </label>
          <Button full onClick={() => setSheet(null)}>
            Aplicar
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}

// ---------- Evento ----------

export function EventScreen({ eventId }: { eventId: string }) {
  const where = useCurrentPosition();
  const waiting = where.status === 'asking';
  const event = useAsync<ExploreEvent | null>(async () => (waiting ? null : api.exploreEvent(eventId, where.position)), [eventId, waiting, where.position?.lat, where.position?.lng]);
  const e = event.data;
  useTitle(e?.title ?? 'Evento');
  const [failed, setFailed] = useState(false);
  const image = e && !failed ? safeImage(e.imageUrl) : null;
  const [planning, setPlanning] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [posted, setPosted] = useState<boolean | undefined>();
  const isPosted = posted ?? e?.postedByMe ?? false;

  return (
    <>
      <PageHead title={e?.title ?? 'Evento'} back="/explorar" />
      {waiting || event.loading ? <Loading /> : null}
      {!waiting && event.error ? (
        <ErrorState message={event.error.message} onRetry={event.reload} />
      ) : null}
      {e ? (
        <article className="eventpage">
          <div className={`evcover evcover--hero evcover--${e.kind.toLowerCase()}`}>
            {image ? <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="evcover__kind" aria-hidden="true">{kindLabel(e.kind)}</span>}
          </div>
          <div className="sugcard__tags">
            <span className="tag tag--event">{kindLabel(e.kind)}</span>
            {e.isFree ? <span className="tag tag--free">Grátis</span> : null}
            {e.sample ? <SampleBadge /> : null}
          </div>
          <dl className="eventpage__facts">
            <div>
              <dt>Quando</dt>
              <dd>{formatWhen(e.startsAt, e.endsAt, new Date())}</dd>
            </div>
            <div>
              <dt>Onde</dt>
              <dd>
                {e.venue.name}
                {e.venue.address ? <span className="eventpage__sub">{e.venue.address}</span> : null}
                {e.distanceM !== null ? <span className="eventpage__sub">a {formatDistance(e.distanceM)} de você</span> : null}
              </dd>
            </div>
          </dl>
          {e.description ? <p className="eventpage__text">{e.description}</p> : null}
          {e.tags.length > 0 ? (
            <ul className="tagchips">
              {e.tags.map((t) => (
                <li key={t}>
                  <button type="button" className="fchip" onClick={() => navigate(`/explorar?q=${encodeURIComponent(`#${t}`)}`)}>
                    #{t}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {Date.parse(e.endsAt) > Date.now() ? (
            <Button full onClick={() => setPlanning(true)}>
              {MEETUP_ACTION_LABEL}
            </Button>
          ) : (
            <p className="muted">Esse evento já terminou.</p>
          )}
          <Button full variant="secondary" onClick={() => setSharing(true)}>
            Compartilhar
          </Button>
          <div className="sugcard__actions">
            <a className="btn btn--quiet btn--small" href={routeLink(e.venue.lat, e.venue.lng)} target="_blank" rel="noopener noreferrer">
              Rota até lá
            </a>
            <a className="btn btn--quiet btn--small" href={mapLink(e.venue.lat, e.venue.lng)} target="_blank" rel="noopener noreferrer">
              Mapa
            </a>
          </div>
        </article>
      ) : null}
      {sharing && e ? <ShareEventSheet eventId={e.id} title={e.title} posted={isPosted} onPostedChange={setPosted} onClose={() => setSharing(false)} /> : null}
      {planning && e ? <CreateMeetupSheet event={e} onClose={() => setPlanning(false)} /> : null}
    </>
  );
}
