import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { ClockIcon, EventKindIcon, MapIcon, SearchIcon } from '../components/icons.tsx';
import { PlacePhoto, Rating, SampleBadge } from '../components/suggestions.tsx';
import { Button, EmptyState, ErrorState, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { safeStorage } from '../lib/hints.ts';
import { addRecent, buildSuggestions, readRecent, removeRecent, saveRecent } from '../lib/recent-searches.ts';
import { filterByThemes, readThemes, THEMES, themeOfCategory, themeOfEvent } from '../lib/themes.ts';
import type { ThemeId } from '../lib/themes.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { formatRating, formatWhen, mapLink, routeLink } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import {
  KINDS,
  RADIUS_DEFAULT_KM,
  RADIUS_MAX_KM,
  RADIUS_MIN_KM,
  RANGES,
  activeFilterCount,
  HOT_MIN_GOING,
  coverShape,
  effectiveQuery,
  kindLabel,
  rangeFor,
  rangeLabel,
  widenSteps,
  safeImage,
  sourceName,
} from '../lib/explore.ts';
import type { RangeId } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { pluralize } from '../lib/format.ts';
import type { EventKind, ExploreEvent, ExplorePlace, ExploreResult } from '../lib/types.ts';
import { trackClick, useDwell } from '../components/dwell.tsx';
import { Link, navigate, useSearch } from '../router.tsx';
import { VenueLink } from '../components/venue-link.tsx';
import { DateBadge, PosterEvent } from '../components/poster.tsx';
import { VenueLogo } from '../components/venue-logo.tsx';
import { openStatus } from '../lib/venue-profile.ts';
import { t } from '../lib/i18n/index.ts';

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

function EventCover({ event, shape, badge = false }: { event: ExploreEvent; shape: string; badge?: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <div className={`evcover evcover--${shape} evcover--${event.kind.toLowerCase()}`}>
      {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="evcover__fallback" aria-hidden="true"><EventKindIcon kind={event.kind} /><span className="evcover__kind">{kindLabel(event.kind)}</span></span>}
      {badge ? <DateBadge startsAt={event.startsAt} mini /> : null}
      <span className="evcover__tags">
        {event.sponsored ? <span className="tag-sponsored">{t('Patrocinado')}</span> : null}
        {event.isFree ? <span className="tag tag--free">{t('Grátis')}</span> : null}
        {event.sample ? <SampleBadge /> : null}
      </span>
    </div>
  );
}

export function EventCard({ event, now, poster }: { event: ExploreEvent; now: Date; poster?: boolean }) {
  if (poster) return <PosterEventCard event={event} now={now} />;
  return (
    <li className="evcard">
      <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evcard__link">
        <EventCover event={event} shape={coverShape(event.id)} badge />
        <div className="evcard__body">
          <h3 className="evcard__title">{event.title}</h3>
          <p className="evcard__venue">
            <VenueLink venueId={event.venue.id} name={event.venue.name} nested />
          </p>
          <p className="evcard__when">{formatWhen(event.startsAt, event.endsAt, now)}</p>
          {event.goingCount !== undefined ? <p className="evcard__hot">{event.goingCount} confirmados agora</p> : null}
          {event.distanceM !== null ? <p className="evcard__dist">a {formatDistance(event.distanceM)}</p> : null}
        </div>
      </Link>
    </li>
  );
}

/** Evento em formato de cartaz (Home): foto inteira, data em destaque e "Eu vou". */
function PosterEventCard({ event, now }: { event: ExploreEvent; now: Date }) {
  const dwellRef = useDwell<HTMLLIElement>('EVENT', event.id, 'FEED');
  return (
    <li className="poster-item" ref={dwellRef} onClickCapture={(ev) => { if ((ev.target as Element).closest('a')) trackClick('EVENT', event.id, 'FEED'); }}>
      <PosterEvent
        eventId={event.id}
        title={event.title}
        startsAt={event.startsAt}
        whenText={formatWhen(event.startsAt, event.endsAt, now)}
        venue={<VenueLink venueId={event.venue.id} name={event.venue.name} />}
        image={safeImage(event.imageUrl)}
        fallback={
          <span className={`evcover evcover--${event.kind.toLowerCase()} poster__fallback`} aria-hidden="true">
            <EventKindIcon kind={event.kind} />
            <span className="evcover__kind">{kindLabel(event.kind)}</span>
          </span>
        }
        count={event.goingCount}
        tags={
          <>
            {event.sponsored ? <span className="tag-sponsored">{t('Patrocinado')}</span> : null}
            {event.isFree ? <span className="tag tag--free">{t('Grátis')}</span> : null}
            {event.sample ? <SampleBadge /> : null}
          </>
        }
      />
    </li>
  );
}

function PlaceRow({ place }: { place: ExplorePlace }) {
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  // Local do AskouT: a chave é `askout:<id>`. Lugar de fora (Google/OSM): o servidor confere na fonte e cria a página na primeira vez.
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

  const venue = place.source === 'ASKOUT' ? place.venue : null;
  const [following, setFollowing] = useState(venue?.following ?? false);
  const [followers, setFollowers] = useState(venue?.followerCount ?? 0);
  const [busy, setBusy] = useState(false);
  async function toggleFollow() {
    if (!venue) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const r = following ? await api.unfollowVenue(venue.id) : await api.followVenue(venue.id);
      setFollowing(r.following);
      setFollowers(r.followerCount);
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  if (venue) {
    const status = openStatus(venue.hours, new Date());
    return (
      <li className="placerow placerow--venue">
        <button type="button" className="placerow__profile" onClick={() => void openPage()} aria-label={t('Abrir página de {name}', { name: place.name })}>
          <VenueLogo name={place.name} logoUrl={venue.logoUrl} size={48} />
          <span className="placerow__info">
            <span className="placerow__name">{place.name}{place.sponsored ? <span className="tag-sponsored">{t('Patrocinado')}</span> : null}</span>
            <span className="placerow__line">
              {[place.category ?? 'Local', place.rating !== null ? `★ ${formatRating(place.rating)}${place.ratingCount ? ` (${place.ratingCount})` : ''}` : null, pluralize(followers, 'seguidor', 'seguidores'), status?.short, place.distanceM !== null ? `a ${formatDistance(place.distanceM)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </button>
        <Button small variant={following ? 'quiet' : 'primary'} loading={busy} onClick={() => void toggleFollow()}>
          {following ? t('Seguindo') : t('Seguir')}
        </Button>
        <div className="placerow__actions">
          <a className="btn btn--quiet btn--small" href={routeLink(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
            {t('Rota')}
          </a>
          <a className="btn btn--quiet btn--small" href={place.mapsUri ?? mapLink(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
            {t('Mapa')}
          </a>
        </div>
        {problem ? <p className="field__error">{problem}</p> : null}
      </li>
    );
  }

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
        {place.category ? `${place.category}` : t('Local')}
        {place.distanceM !== null ? ` · a ${formatDistance(place.distanceM)}` : ''}
      </p>
      {problem ? <p className="field__error">{problem}</p> : null}
      <div className="sugcard__actions">
        <Button small loading={opening} onClick={() => void openPage()}>
          {t('Ver página')}
        </Button>
        <a className="btn btn--quiet btn--small" href={routeLink(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
          {t('Rota')}
        </a>
        <a className="btn btn--quiet btn--small" href={place.mapsUri ?? mapLink(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
          {t('Mapa')}
        </a>
      </div>
    </li>
  );
}

type Tab = 'all' | 'events' | 'places' | 'people' | 'tags';

// ---------- Tela ----------

export function ExploreScreen() {
  useTitle(t('Explorar'));
  const initialQuery = useSearch().get('q') ?? '';
  const [query, setQuery] = useState(initialQuery.slice(0, 80));
  const [range, setRange] = useState<RangeId>('today');
  const [kind, setKind] = useState<EventKind | null>(null);
  const [free, setFree] = useState(false);
  const [hot, setHot] = useState(false);
  const me = useUser();
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent(safeStorage(), me.id));
  function commitSearch(term: string) {
    setRecent((current) => {
      const next = addRecent(current, term);
      saveRecent(safeStorage(), me.id, next);
      return next;
    });
  }
  function forgetSearch(term?: string) {
    setRecent((current) => {
      const next = term === undefined ? [] : removeRecent(current, term);
      saveRecent(safeStorage(), me.id, next);
      return next;
    });
  }
  const [themes, setThemes] = useState<ReadonlySet<ThemeId>>(() => {
    // O que a pessoa escolheu no começo vira o filtro inicial, a não ser que ela tenha marcado todos (aí não filtra nada).
    const saved = readThemes(safeStorage(), me.id);
    return saved.length === THEMES.length ? new Set() : new Set(saved);
  });
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
      hot,
    });
  }, [q, range, kind, free, hot, radiusKm, position?.lat, position?.lng, waiting]);

  const raw = result.data;
  // Tema é filtro de tela: a API devolve tudo e aqui fica só o que é de Bares e/ou Baladas.
  const data = useMemo(
    () =>
      raw
        ? {
            ...raw,
            events: filterByThemes(raw.events, themes, themeOfEvent),
            places: filterByThemes(raw.places, themes, (p) => themeOfCategory(p.category)),
          }
        : raw,
    [raw, themes],
  );
  const now = useMemo(() => new Date(), [data]);
  const searching = q !== '';
  const filters = activeFilterCount({ range, kind, free, radiusKm, hot }) + (themes.size > 0 ? 1 : 0);

  function toggleTheme(id: ThemeId) {
    setThemes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setThemes(new Set());
    setRange('today');
    setKind(null);
    setFree(false);
    setHot(false);
    setRadiusKm(RADIUS_DEFAULT_KM);
  }

  function searchTag(tag: string) {
    setQuery(`#${tag}`);
    setTab('events');
    inputRef.current?.focus();
  }

  // Abriu sem nada para hoje: procura sozinho o primeiro filtro mais amplo que tenha evento e já deixa selecionado (uma vez só, e só se a pessoa ainda não mexeu em nada).
  const autoTried = useRef(false);
  const alive = useRef(true);
  const [autoRange, setAutoRange] = useState<RangeId | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (autoTried.current || waiting || result.loading || !raw) return;
    autoTried.current = true;
    const untouched = q === '' && range === 'today' && kind === null && !free && !hot && radiusKm === RADIUS_DEFAULT_KM;
    if (!untouched || filterByThemes(raw.events, themes, themeOfEvent).length > 0) return;
    void (async () => {
      for (const step of widenSteps({ hasThemes: themes.size > 0, located: position !== undefined })) {
        const { from, to } = rangeFor(step.range, new Date());
        try {
          const r = await api.explore({
            lat: position?.lat,
            lng: position?.lng,
            radiusKm: position ? step.radiusKm : undefined,
            from: from.toISOString(),
            to: to.toISOString(),
            free: false,
            hot: false,
          });
          if (!alive.current) return;
          const events = step.clearThemes ? r.events : filterByThemes(r.events, themes, themeOfEvent);
          if (events.length > 0) {
            if (step.clearThemes) setThemes(new Set());
            if (step.radiusKm !== RADIUS_DEFAULT_KM) setRadiusKm(step.radiusKm);
            setRange(step.range);
            setAutoRange(step.range);
            return;
          }
        } catch {
          return;
        }
      }
    })();
    // Roda uma vez, quando o primeiro resultado chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, waiting, result.loading]);

  const hasResults = data !== undefined && data !== null && data.events.length + data.places.length + data.people.length > 0;
  // Buscou, achou e ficou na tela: entra nas recentes (sem salvar cada letra digitada).
  useEffect(() => {
    if (q === '' || !hasResults) return;
    const timer = setTimeout(() => commitSearch(q), 1500);
    return () => clearTimeout(timer);
    // commitSearch só usa o setter e o id do usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hasResults]);
  const suggestions = buildSuggestions({ tags: raw?.tags ?? [], places: raw?.places ?? [], recent });
  const showPanel = focused && query.trim() === '' && (recent.length > 0 || suggestions.length > 0);
  function pick(term: string) {
    setQuery(term);
    commitSearch(term);
  }

  const counts = data ? { events: data.events.length, places: data.places.length, people: data.people.length, tags: data.tags.length } : null;
  const tabs: { id: Tab; label: string; n: number | null }[] = [
    { id: 'all', label: t('Tudo'), n: null },
    { id: 'events', label: t('Eventos'), n: counts?.events ?? null },
    { id: 'places', label: t('Locais'), n: counts?.places ?? null },
    { id: 'people', label: t('Pessoas'), n: counts?.people ?? null },
    { id: 'tags', label: '#', n: counts?.tags ?? null },
  ];
  const show = (section: Exclude<Tab, 'all'>) => tab === 'all' || tab === section;
  const nothing = data && data.events.length + data.places.length + data.people.length + data.tags.length === 0;

  return (
    <>
      <PageHead
        title={t('Explorar')}
        action={
          <Link to="/explorar/mapa" className="btn btn--secondary btn--small">
            <MapIcon /> Ver no mapa
          </Link>
        }
      />

      <div className="search search--explore" role="search">
        <span className="search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <label className="visually-hidden" htmlFor="busca">
          {t('Buscar eventos, rolês, pessoas ou #')}
        </label>
        <input
          id="busca"
          ref={inputRef}
          className="search__input search__input--icon"
          type="search"
          placeholder={t('Eventos, rolês, pessoas ou #')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitSearch(query);
          }}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={80}
        />
      </div>

      {showPanel ? (
        // onPointerDown evita que o campo perca o foco (e o painel suma) antes do toque valer.
        <div className="searchpanel" onPointerDown={(event) => event.preventDefault()}>
          {recent.length > 0 ? (
            <section aria-label={t('Buscas recentes')}>
              <div className="searchpanel__head">
                <h2 className="searchpanel__h">{t('Recentes')}</h2>
                <button type="button" className="searchpanel__clear" onClick={() => forgetSearch()}>
                  {t('Limpar')}
                </button>
              </div>
              <ul className="searchpanel__list">
                {recent.map((term) => (
                  <li key={term} className="searchpanel__row">
                    <button type="button" className="searchpanel__item" onClick={() => pick(term)}>
                      <ClockIcon />
                      <span>{term}</span>
                    </button>
                    <button type="button" className="searchpanel__x" aria-label={t('Apagar a busca {term}', { term })} onClick={() => forgetSearch(term)}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {suggestions.length > 0 ? (
            <section aria-label={t('Sugestões')}>
              <h2 className="searchpanel__h">{t('Sugestões')}</h2>
              <ul className="tagchips">
                {suggestions.map((term) => (
                  <li key={term}>
                    <button type="button" className="fchip" onClick={() => pick(term)}>
                      {term}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="filters" role="group" aria-label={t('Filtros')}>
        {THEMES.map((theme) => (
          <button key={theme.id} type="button" className={`fchip fchip--theme${themes.has(theme.id) ? ' fchip--on' : ''}`} aria-pressed={themes.has(theme.id)} onClick={() => toggleTheme(theme.id)}>
            {theme.label}
          </button>
        ))}
        <button type="button" className={`fchip fchip--hot${hot ? ' fchip--on' : ''}`} aria-pressed={hot} onClick={() => setHot((v) => !v)}>
          {t('Bombando')}
        </button>
        <button type="button" className={`fchip${range !== 'today' && !hot ? ' fchip--on' : ''}`} onClick={() => setSheet('range')} aria-haspopup="dialog" disabled={hot}>
          {rangeLabel(range)} <span aria-hidden="true">▾</span>
        </button>
        <button type="button" className={`fchip${kind ? ' fchip--on' : ''}`} onClick={() => setSheet('kind')} aria-haspopup="dialog">
          {kind ? kindLabel(kind) : t('Tipo de evento')} <span aria-hidden="true">▾</span>
        </button>
        <button type="button" className={`fchip${free ? ' fchip--on' : ''}`} aria-pressed={free} onClick={() => setFree((v) => !v)}>
          {t('Grátis')}
        </button>
        <button type="button" className={`fchip${radiusKm !== RADIUS_DEFAULT_KM ? ' fchip--on' : ''}`} onClick={() => setSheet('radius')} aria-haspopup="dialog" disabled={!position}>
          Raio {radiusKm} km <span aria-hidden="true">▾</span>
        </button>
        {filters > 0 ? (
          <button type="button" className="fchip fchip--clear" onClick={clearFilters}>
            {t('Limpar')}
          </button>
        ) : null}
      </div>

      {where.status === 'denied' || where.status === 'unavailable' ? (
        <p className="muted explore__note">
          {where.status === 'denied'
            ? t('Sem a sua localização não dá para mostrar o que está perto. Os eventos aparecem sem distância; libere a localização nas configurações do navegador.')
            : t('Não foi possível pegar a sua localização. Os eventos aparecem sem distância.')}
        </p>
      ) : null}

      {searching ? (
        <div className="segtabs" role="tablist" aria-label={t('Resultados')}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
              {t.label}
              {t.n !== null ? <span className="segtabs__n">{t.n}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {waiting || result.loading ? <Loading label={waiting ? t('Buscando a sua localização') : t('Buscando')} /> : null}
      {!waiting && result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}

      {!waiting && !result.loading && data ? (
        <>
          {!searching ? (
            data.events.length === 0 ? (
              <EmptyState
                title={hot ? t('Nada bombando agora') : t('Nenhum evento por aqui')}
                action={
                  filters > 0 || range !== 'any' ? (
                    <Button small variant="secondary" onClick={() => (filters > 0 ? clearFilters() : setRange('any'))}>
                      {filters > 0 ? t('Limpar filtros') : t('Ver os próximos 30 dias')}
                    </Button>
                  ) : undefined
                }
              >
                {hot
                  ? (data.located ? t('Nenhum evento acontecendo agora tem {n} ou mais pessoas confirmadas a até {km} km.', { n: HOT_MIN_GOING, km: data.radiusKm }) : t('Nenhum evento acontecendo agora tem {n} ou mais pessoas confirmadas.', { n: HOT_MIN_GOING }))
                  : (data.located ? t('Ainda não há eventos cadastrados a até {km} km neste período. Busque por um rolê, uma pessoa ou uma #.', { km: data.radiusKm }) : t('Ainda não há eventos cadastrados neste período. Busque por um rolê, uma pessoa ou uma #.'))}
              </EmptyState>
            ) : (
              <>
                {autoRange !== null && range === autoRange ? <p className="muted" role="status">{t('Nada para hoje. Mostrando: {periodo}.', { periodo: rangeLabel(autoRange) })}</p> : null}
                <p className="muted" aria-live="polite">
                  {pluralize(data.events.length, t('evento'), t('eventos'))} {hot ? t('bombando agora') : data.located ? t('a até {km} km', { km: data.radiusKm }) : t('no período')}
                </p>
                <ul className="evgrid">
                  {data.events.map((e) => (
                    <EventCard key={e.id} event={e} now={now} />
                  ))}
                </ul>
              </>
            )
          ) : nothing ? (
            <EmptyState title={t('Nada encontrado')}>
              {q.startsWith('#') ? t('Nenhum evento com essa #.') : t('Confira o que digitou ou aumente o raio. Rolês de fora só aparecem com a sua localização liberada.')}
            </EmptyState>
          ) : (
            <div className="results">
              {show('tags') && data.tags.length > 0 ? (
                <section aria-label={t('Hashtags')}>
                  <h2 className="results__h">{t('Hashtags')}</h2>
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
                <section aria-label={t('Eventos')}>
                  <h2 className="results__h">{t('Eventos')}</h2>
                  <ul className="evgrid">
                    {data.events.map((e) => (
                      <EventCard key={e.id} event={e} now={now} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {show('places') && data.places.length > 0 ? (
                <section aria-label={t('Locais')}>
                  <h2 className="results__h">{t('Rolês')}</h2>
                  <ul className="placelist">
                    {data.places.map((p) => (
                      <PlaceRow key={p.key} place={p} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {show('places') && !data.placesAvailable ? <p className="muted">{t('A fonte de rolês de fora não respondeu agora. Os locais do AskouT aparecem normalmente.')}</p> : null}
              {show('people') && data.people.length > 0 ? (
                <section aria-label={t('Pessoas')}>
                  <h2 className="results__h">{t('Pessoas')}</h2>
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
        <Sheet title={t('Quando')} onClose={() => setSheet(null)}>
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
        <Sheet title={t('Tipo de evento')} onClose={() => setSheet(null)}>
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
                {t('Todos os tipos')}
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
        <Sheet title={t('Raio')} onClose={() => setSheet(null)}>
          <label className="radius" htmlFor="raio">
            <span className="radius__value">{radiusKm} km</span>
            <input id="raio" type="range" min={RADIUS_MIN_KM} max={RADIUS_MAX_KM} step={1} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} />
            <span className="radius__scale">
              <span>{RADIUS_MIN_KM} km</span>
              <span>{RADIUS_MAX_KM} km</span>
            </span>
          </label>
          <Button full onClick={() => setSheet(null)}>
            {t('Aplicar')}
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}
