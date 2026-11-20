import { OpenInMaps } from '../components/open-in-maps.tsx';
import { ExploreViews } from '../components/explore-views.tsx';
import { ExploreSearch } from '../components/explore-search.tsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { ClockIcon, EventKindIcon } from '../components/icons.tsx';
import { PlacePhoto, Rating, SampleBadge } from '../components/suggestions.tsx';
import { Button, EmptyState, ErrorState, Loading, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useIsVisitor, useOptionalUser, useUser } from '../auth.tsx';
import { useVisitorCity } from '../components/visitor.tsx';
import { safeStorage } from '../lib/hints.ts';
import { addRecent, buildSuggestions, readRecent, removeRecent, saveRecent } from '../lib/recent-searches.ts';
import { filterByThemes, themeFilter, themesOfCategory, themesOfEvent, userThemes } from '../lib/themes.ts';
import type { ThemeId } from '../lib/themes.ts';
import { useThemes } from '../lib/use-themes.ts';
import { isLiveNow, liveFirst } from '../lib/live-events.ts';
import { LiveTag } from '../components/live-tag.tsx';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { formatRating, formatWhen, } from '../lib/chat.ts';
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
import { eventTone } from '../lib/explore.ts';
import type { RangeId } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { pluralize } from '../lib/format.ts';
import type { EventKind, ExploreEvent, ExplorePlace, ExploreResult } from '../lib/types.ts';
import { useLongPress } from '../components/tile-press.tsx';
import { trackClick, useDwell } from '../components/dwell.tsx';
import { trackSponsoredOpen, useSponsoredView } from '../components/sponsored-view.tsx';
import { Link, navigate, useSearch } from '../router.tsx';
import { VenueLink } from '../components/venue-link.tsx';
import { DateBadge, PosterEvent } from '../components/poster.tsx';
import { VenueLogo } from '../components/venue-logo.tsx';
import { openStatus } from '../lib/venue-profile.ts';
import { t } from '../lib/i18n/index.ts';
import { cachedPosition, requestPosition } from '../lib/position.ts';
import type { Position } from '../lib/position.ts';

// ---------- Posição (uma só para o app; pedida logo depois do login, ver lib/position.ts) ----------

type LocationState = { status: 'asking' | 'denied' | 'unavailable'; position?: undefined } | { status: 'ok'; position: Position };

/**
 * A posição do aparelho: a que o app já pediu depois do login, ou pede agora se ainda não pediu.
 * Visitante (sem conta): nunca pede a localização; vale a cidade escolhida à mão (sem ela, fica indisponível).
 */
export function useCurrentPosition(): LocationState {
  const visitor = useIsVisitor();
  const city = useVisitorCity();
  const device = useDevicePosition(!visitor);
  if (visitor) return city ? { status: 'ok', position: city.position } : { status: 'unavailable' };
  return device;
}

function useDevicePosition(enabled: boolean): LocationState {
  const [state, setState] = useState<LocationState>(() => {
    const cached = cachedPosition();
    return cached ? { status: 'ok', position: cached } : { status: 'asking' };
  });
  useEffect(() => {
    if (!enabled || state.status === 'ok') return;
    let alive = true;
    void requestPosition().then((result) => {
      if (!alive) return;
      setState(result.status === 'ok' ? { status: 'ok', position: result.position } : { status: result.status });
    });
    return () => {
      alive = false;
    };
    // Roda uma vez ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

// ---------- Peças de tela ----------

function EventCover({ event, shape, badge = false, live = false }: { event: ExploreEvent; shape: string; badge?: boolean; live?: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <div className={`evcover evcover--${shape} evcover--${event.kind.toLowerCase()} evtone evtone-${eventTone(event.id)}`}>
      {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="evcover__fallback" aria-hidden="true"><EventKindIcon kind={event.kind} /><span className="evcover__kind">{kindLabel(event.kind)}</span></span>}
      {badge ? <DateBadge startsAt={event.startsAt} mini /> : null}
      <span className="evcover__tags">
        {live ? <LiveTag /> : null}
        {event.sponsored ? <span className="tag-sponsored">{t('Patrocinado')}</span> : null}
        {event.isFree && !badge ? <span className="tag tag--free">{t('Grátis')}</span> : null}
        {event.sample ? <SampleBadge /> : null}
      </span>
      {event.isFree && badge ? <span className="tag tag--free evcover__free">{t('Grátis')}</span> : null}
    </div>
  );
}

export function EventCard({ event, now, poster }: { event: ExploreEvent; now: Date; poster?: boolean }) {
  if (poster) return <PosterEventCard event={event} now={now} />;
  return <ListEventCard event={event} now={now} />;
}

/** Evento em lista (Explorar). */
function ListEventCard({ event, now }: { event: ExploreEvent; now: Date }) {
  const adRef = useSponsoredView<HTMLLIElement>(event.sponsored === true, 'EXPLORE', { eventId: event.id });
  // Segurar o card expande/recolhe com mais detalhes (descrição, endereço, horário completo).
  const [expanded, setExpanded] = useState(false);
  const press = useLongPress(() => setExpanded((v) => !v), true);
  return (
    <li className={`evcard${isLiveNow(event, now) ? ' evcard--live' : ''}${expanded ? ' evcard--expanded' : ''}`} ref={adRef}>
      <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evcard__link" {...press} aria-expanded={expanded} onClick={(ev) => { press.onClick?.(ev); if (ev.defaultPrevented) return; if (event.sponsored) trackSponsoredOpen('EXPLORE', { eventId: event.id }); }}>
        <EventCover event={event} shape={coverShape(event.id)} badge live={isLiveNow(event, now)} />
        <div className="evcard__body">
          <h3 className="evcard__title">{event.title}</h3>
          {event.venue.name ? (
            <p className="evcard__venue">
              <VenueLink venueId={event.venue.id} name={event.venue.name} nested />
            </p>
          ) : null}
          {event.author ? <p className="evcard__author">{t('Criado por @{username}', { username: event.author.username })}</p> : null}
          <p className="evcard__when">{formatWhen(event.startsAt, event.endsAt, now)}</p>
          {event.goingCount !== undefined ? <p className="evcard__hot">{t('{n} confirmados agora', { n: event.goingCount })}</p> : null}
          {event.distanceM !== null ? <p className="evcard__dist">{t('a {distance}', { distance: formatDistance(event.distanceM) })}</p> : null}
          {expanded ? (
            <div className="evcard__more">
              {event.venue.address ? <p>{event.venue.address}</p> : null}
              <p>{kindLabel(event.kind)}{event.isFree ? ` · ${t('Grátis')}` : ''}</p>
              {event.description ? <p className="evcard__desc">{event.description}</p> : null}
              {event.tags.length > 0 ? <p>{event.tags.slice(0, 5).map((tg) => `#${tg}`).join(' ')}</p> : null}
            </div>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/** Evento em formato de cartaz (Home): foto inteira, data em destaque e "Eu vou". */
function PosterEventCard({ event, now }: { event: ExploreEvent; now: Date }) {
  // Também aparece na Home de quem não entrou (sem usuário): aí o "Eu vou" sempre aparece e pede login.
  const me = useOptionalUser();
  const dwellRef = useDwell<HTMLLIElement>('EVENT', event.id, 'FEED');
  // O cartaz patrocinado aparece na Home ("Rolês em destaque").
  useSponsoredView<HTMLLIElement>(event.sponsored === true, 'HOME', { eventId: event.id }, dwellRef);
  return (
    <li className="poster-item" ref={dwellRef} onClickCapture={(ev) => { if ((ev.target as Element).closest('a')) { trackClick('EVENT', event.id, 'FEED'); if (event.sponsored) trackSponsoredOpen('HOME', { eventId: event.id }); } }}>
      <PosterEvent
        eventId={event.id}
        title={event.title}
        startsAt={event.startsAt}
        endsAt={event.endsAt}
        whenText={formatWhen(event.startsAt, event.endsAt, now)}
        venue={<VenueLink venueId={event.venue.id} name={event.venue.name} />}
        image={safeImage(event.imageUrl)}
        fallback={
          <span className={`evcover evcover--${event.kind.toLowerCase()} evtone evtone-${eventTone(event.id)} poster__fallback`} aria-hidden="true">
            <EventKindIcon kind={event.kind} />
            <span className="evcover__kind">{kindLabel(event.kind)}</span>
          </span>
        }
        count={event.goingCount}
        hideGoing={me !== undefined && event.author?.userId === me.id}
        tags={
          <>
            {isLiveNow(event, now) ? <LiveTag /> : null}
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
  const adRef = useSponsoredView<HTMLLIElement>(place.sponsored === true && venue !== null, 'EXPLORE', { venueId: venue?.id });
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
      <li className="placerow placerow--venue" ref={adRef}>
        <button type="button" className="placerow__profile" onClick={() => { if (place.sponsored) trackSponsoredOpen('EXPLORE', { venueId: venue.id }); void openPage(); }} aria-label={t('Abrir página de {name}', { name: place.name })}>
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
        <Button small variant={following ? 'quiet' : 'primary'} loading={busy} onClick={() => toggleFollow()}>
          {following ? t('Seguindo') : t('Seguir')}
        </Button>
        <div className="placerow__actions">
          <OpenInMaps className="btn btn--quiet btn--small" mode="route" lat={place.lat} lng={place.lng} label={place.name}>
            {t('Rota')}
          </OpenInMaps>
          <OpenInMaps className="btn btn--quiet btn--small" lat={place.lat} lng={place.lng} label={place.name} googleUrl={place.mapsUri}>
            {t('Mapa')}
          </OpenInMaps>
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
        <Button small loading={opening} onClick={() => openPage()}>
          {t('Ver página')}
        </Button>
        <OpenInMaps className="btn btn--quiet btn--small" mode="route" lat={place.lat} lng={place.lng} label={place.name}>
          {t('Rota')}
        </OpenInMaps>
        <OpenInMaps className="btn btn--quiet btn--small" lat={place.lat} lng={place.lng} label={place.name} googleUrl={place.mapsUri}>
          {t('Mapa')}
        </OpenInMaps>
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
  const allThemes = useThemes();
  const [themes, setThemes] = useState<ReadonlySet<ThemeId>>(() => {
    // O que a pessoa escolheu no começo vira o filtro inicial, a não ser que ela tenha marcado todos (aí não filtra nada).
    return themeFilter(userThemes(safeStorage(), me));
  });
  const [radiusKm, setRadiusKm] = useState(RADIUS_DEFAULT_KM);
  const [sheet, setSheet] = useState<'range' | 'kind' | 'radius' | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const where = useCurrentPosition();
  const debounced = useDebounced(query, 300);
  const q = effectiveQuery(debounced);
  // Ainda digitando: a busca de verdade sai quando a pessoa para por um instante.
  const typing = effectiveQuery(query) !== '' && effectiveQuery(query) !== q;
  const position = where.position;
  const waiting = where.status === 'asking';

  const result = useAsync<ExploreResult | null>(async () => {
    if (waiting) return null;
    const { from, to } = rangeFor(range, new Date());
    return api.explore({
      q: q || undefined,
      lat: position?.lat,
      lng: position?.lng,
      // Sem texto vale o raio escolhido (padrão 10 km). Busca por nome ou # procura em qualquer distância.
      radiusKm: position && !q ? radiusKm : undefined,
      from: from.toISOString(),
      to: to.toISOString(),
      kind: kind ?? undefined,
      free,
      hot,
    });
  }, [q, range, kind, free, hot, radiusKm, position?.lat, position?.lng, waiting]);

  const raw = result.data;
  // "Carregar mais" ao rolar: páginas seguintes dos eventos, somadas à primeira (que vem do useAsync acima).
  const [more, setMore] = useState<{ events: ExploreEvent[]; hasMore: boolean | undefined; loading: boolean }>({ events: [], hasMore: undefined, loading: false });
  useEffect(() => {
    setMore({ events: [], hasMore: undefined, loading: false });
  }, [raw]);
  const serverCount = (raw?.events.length ?? 0) + more.events.length;
  const canLoadMore = !!raw && !hot && (more.hasMore ?? raw.hasMore) === true;
  const loadMore = useCallback(async () => {
    if (!raw || more.loading) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const { from, to } = rangeFor(range, new Date());
      const page = await api.explore({
        q: q || undefined,
        lat: position?.lat,
        lng: position?.lng,
        radiusKm: position && !q ? radiusKm : undefined,
        from: from.toISOString(),
        to: to.toISOString(),
        kind: kind ?? undefined,
        free,
        offset: serverCount,
      });
      setMore((m) => ({ events: [...m.events, ...page.events.filter((e) => !m.events.some((x) => x.id === e.id) && !raw.events.some((x) => x.id === e.id))], hasMore: page.hasMore === true, loading: false }));
    } catch {
      setMore((m) => ({ ...m, hasMore: false, loading: false }));
    }
  }, [raw, more.loading, range, q, position?.lat, position?.lng, radiusKm, kind, free, serverCount]);
  // Quando o fim da lista chega perto da tela, busca a próxima página.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || more.loading || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, more.loading, loadMore, serverCount]);
  // Tema é filtro de tela: a API devolve tudo e aqui fica só o que é dos gostos escolhidos.
  const data = useMemo(
    () =>
      raw
        ? {
            ...raw,
            events: liveFirst(filterByThemes([...raw.events, ...more.events], themes, themesOfEvent), new Date()),
            places: filterByThemes(raw.places, themes, (p) => themesOfCategory(p.category)),
          }
        : raw,
    [raw, more.events, themes],
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
  // Enquanto procura um período mais amplo, a tela segue "buscando" em vez de piscar o vazio antes da troca.
  // 'found': achou e trocou os filtros; segue buscando até o resultado novo chegar (o antigo, vazio, ainda está em `raw`).
  const [widening, setWidening] = useState<false | 'searching' | 'found'>(false);
  const staleRaw = useRef<ExploreResult | null | undefined>(undefined);
  const untouched = q === '' && range === 'today' && kind === null && !free && !hot && radiusKm === RADIUS_DEFAULT_KM;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (autoTried.current || waiting || result.loading || !raw) return;
    autoTried.current = true;
    if (!untouched || filterByThemes(raw.events, themes, themesOfEvent).length > 0) return;
    setWidening('searching');
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
          const events = step.clearThemes ? r.events : filterByThemes(r.events, themes, themesOfEvent);
          if (events.length > 0) {
            staleRaw.current = raw;
            setWidening('found');
            if (step.clearThemes) setThemes(new Set());
            if (step.radiusKm !== RADIUS_DEFAULT_KM) setRadiusKm(step.radiusKm);
            setRange(step.range);
            setAutoRange(step.range);
            return;
          }
        } catch {
          if (alive.current) setWidening(false);
          return;
        }
      }
      if (alive.current) setWidening(false);
    })();
    // Roda uma vez, quando o primeiro resultado chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, waiting, result.loading]);
  useEffect(() => {
    if (widening === 'found' && !result.loading && (raw !== staleRaw.current || result.error)) setWidening(false);
  }, [widening, result.loading, raw]);
  // Primeiro desenho com o vazio de hoje, antes de o efeito acima começar a procurar: já conta como buscando.
  const autoPending =
    !autoTried.current && !waiting && !result.loading && !!raw && untouched && filterByThemes(raw.events, themes, themesOfEvent).length === 0;
  const busy = waiting || result.loading || widening !== false || autoPending;

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
    {/* No celular é transparente (display: contents); no computador vira a coluna larga do Explorar. */}
    <div className="explore">
      {/* Sem título visível: a aba do rodapé já diz que é o Explorar. */}
      <h1 className="visually-hidden">{t('Explorar')}</h1>

      {/* Busca sempre no topo: fica presa logo abaixo da barra do app enquanto a lista rola. */}
      <div className="explore__sticky">
        <ExploreSearch
          id="busca"
          inputRef={inputRef}
          value={query}
          onChange={setQuery}
          onSubmit={commitSearch}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          busy={typing || (searching && result.loading)}
        />

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
      </div>
      <ExploreViews current="list" />

      <div className="filters" role="group" aria-label={t('Filtros')}>
        {allThemes.map((theme) => (
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

      {busy ? <Loading label={waiting ? t('Buscando a sua localização') : t('Buscando')} /> : null}
      {!waiting && result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}

      {!busy && data ? (
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
                {autoRange !== null && range === autoRange ? <p className="muted explore__auto" role="status">{t('Nada para hoje. Mostrando: {periodo}.', { periodo: rangeLabel(autoRange) })}</p> : null}
                <p className="muted explore__count" aria-live="polite">
                  {pluralize(data.events.length, t('evento'), t('eventos'))} {hot ? t('bombando agora') : data.located ? t('a até {km} km', { km: data.radiusKm }) : t('no período')}
                </p>
                <ul className="evgrid">
                  {data.events.map((e) => (
                    <EventCard key={e.id} event={e} now={now} />
                  ))}
                </ul>
                {canLoadMore ? (
                  <div ref={sentinel} className="explore__more" aria-live="polite">
                    {more.loading ? <span className="muted">{t('Carregando mais…')}</span> : <Button small variant="secondary" onClick={() => void loadMore()}>{t('Ver mais eventos')}</Button>}
                  </div>
                ) : null}
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
                  {canLoadMore ? (
                    <div ref={sentinel} className="explore__more" aria-live="polite">
                    {more.loading ? <span className="muted">{t('Carregando mais…')}</span> : <Button small variant="secondary" onClick={() => void loadMore()}>{t('Ver mais eventos')}</Button>}
                    </div>
                  ) : null}
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
    </div>
    </>
  );
}
