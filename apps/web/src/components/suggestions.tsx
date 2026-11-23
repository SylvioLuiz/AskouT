import { OpenInMaps } from './open-in-maps.tsx';
import { VenueLink } from './venue-link.tsx';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { useAsync } from '../hooks.ts';
import { formatDistances, formatRating, formatWhen, ratingLabel, sourceLabel, starPercent, toCard } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, ExplorePlace, SuggestionCard, SuggestionItem } from '../lib/types.ts';
import { MAX_PLACES_ON_MAP, formatDistance, placeName, sortByFairness } from '../lib/flash.ts';
import { NOW_RADIUS_CHOICES_KM, nextRadiusKm, nowRadiusKm, setNowRadiusKm } from '../lib/now-radius.ts';
import { initials } from '../lib/avatar.ts';
import { lazyWithReload } from '../lib/chunk-reload.ts';
import type { PlacePin } from './match-map.tsx';
import { MatchPlaceSearch } from './match-place-search.tsx';
import { RingLoader } from './ring-loader.tsx';
import { Sheet } from './agenda.tsx';
import { Button, Confirm, Loading, Notice } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

const MatchMap = lazyWithReload(() => import('./match-map.tsx'));
const MiniPlaceMap = lazyWithReload(() => import('./mini-place-map.tsx'));

/** Selo de dado de exemplo: o app nunca apresenta como real o que foi criado para teste. */
export function SampleBadge() {
  return <span className="tag tag--sample">{t('Exemplo de teste')}</span>;
}

function SourceTag({ source }: { source: SuggestionCard['source'] }) {
  return <span className={`tag tag--${source === 'EVENT' || source === 'PLACE' ? 'event' : source === 'GOOGLE' ? 'google' : 'osm'}`}>{sourceLabel(source)}</span>;
}

/** Estrelas e nota do Google. O crédito "Google" é exigido pelos termos de uso do serviço. */
export function Rating({ rating, count }: { rating: number; count: number | null }) {
  return (
    <p className="rating" aria-label={ratingLabel(rating, count)}>
      <span className="stars" aria-hidden="true" style={{ ['--fill' as string]: `${starPercent(rating)}%` }}>
        ★★★★★
      </span>
      <span aria-hidden="true">
        {formatRating(rating)}
        {count !== null ? ` (${count})` : ''} · Google
      </span>
    </p>
  );
}

/** Foto do lugar, buscada pelo servidor. Se falhar, o cartão segue sem foto. */
export function PlacePhoto({ path, author }: { path: string; author: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="sugcard__photo">
      <img src={api.assetUrl(path)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      <figcaption>{t('Foto:')} {author ? `${author} · ` : ''}Google</figcaption>
    </figure>
  );
}

function Distances({ distances, otherName }: { distances: { meM: number; themM: number }; otherName: string }) {
  return (
    <ul className="sugcard__routes" aria-label={t('Distância até o local, em linha reta')}>
      <li>
        <strong>{t('Você')}</strong> a {formatDistance(distances.meM)}
      </li>
      <li>
        <strong>{otherName}</strong> a {formatDistance(distances.themM)}
      </li>
    </ul>
  );
}

/** O cartão dentro de uma mensagem da conversa: distâncias dos dois, rota e aceitar/recusar. */
export function SuggestionBubble({ message, otherName, nowIso, conversationId, onUpdated, onOpenMap, agreed, onSuggestOther }: { message: ChatMessage; otherName: string; nowIso: string; conversationId: string; onUpdated: (m: ChatMessage) => void; onOpenMap?: (place: { name: string; lat: number; lng: number }) => void; agreed?: { id: string; name: string } | undefined; onSuggestOther?: (() => void) | undefined }) {
  const card = message.suggestion as SuggestionCard;
  const [busy, setBusy] = useState<'accept' | 'decline' | 'cancel' | 'withdraw' | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  const [confirmAccept, setConfirmAccept] = useState(false);
  /** Já há outro local aceito: aceitar este cancela aquele, então pergunta antes. */
  const replaces = agreed && agreed.id !== message.id ? agreed : undefined;

  async function answer(action: 'accept' | 'decline' | 'cancel' | 'withdraw') {
    setBusy(action);
    setProblem(undefined);
    try {
      onUpdated(await api.respondSuggestion(conversationId, message.id, action));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="sugcard sugcard--inline">
      <button type="button" className="minimap__open" onClick={() => onOpenMap?.({ name: card.venueName, lat: card.lat, lng: card.lng })} aria-label={t('Ver {name} no mapa com vocês dois', { name: card.venueName })}>
        <Suspense fallback={<div className="minimap" aria-hidden="true" />}>
          <MiniPlaceMap lat={card.lat} lng={card.lng} name={card.venueName} />
        </Suspense>
      </button>
      <div className="sugcard__tags">
        <SourceTag source={card.source} />
        {card.sample ? <SampleBadge /> : null}
      </div>
      <p className="sugcard__title">{card.title}</p>
      {card.venueName !== card.title ? <p className="sugcard__venue">{card.venueName}</p> : null}
      <p className="sugcard__when">{formatWhen(card.startsAt, card.endsAt, new Date(nowIso))}</p>
      {message.distances ? <Distances distances={message.distances} otherName={otherName} /> : null}
      <div className="sugcard__links">
        <OpenInMaps mode="route" lat={card.lat} lng={card.lng} label={card.venueName}>
          {t('Rota até lá')}
        </OpenInMaps>
        {onOpenMap ? (
          <button type="button" className="mapsbtn" onClick={() => onOpenMap({ name: card.venueName, lat: card.lat, lng: card.lng })}>
            {t('Ver no mapa')}
          </button>
        ) : (
          <OpenInMaps lat={card.lat} lng={card.lng} label={card.venueName}>
            {t('Ver no mapa')}
          </OpenInMaps>
        )}
      </div>
      {message.response === 'CANCELED' ? (
        <p className="sugcard__answer sugcard__answer--canceled" role="status">
          {message.mine ? t('Você cancelou esta sugestão') : t('Sugestão cancelada')}
        </p>
      ) : message.response ? (
        <>
          <p className={`sugcard__answer sugcard__answer--${message.response === 'ACCEPTED' ? 'yes' : 'no'}`} role="status">
            {message.response === 'ACCEPTED' ? (message.mine ? t('{name} aceitou', { name: otherName }) : t('Você aceitou')) : message.mine ? t('{name} recusou', { name: otherName }) : t('Você recusou')}
          </p>
          {message.response === 'ACCEPTED' && !message.mine ? (
            <div className="sugcard__actions">
              <Button small variant="secondary" loading={busy === 'cancel'} onClick={() => answer('cancel')}>
                {t('Cancelar aceite')}
              </Button>
            </div>
          ) : null}
          {message.response === 'ACCEPTED' && message.mine ? (
            <div className="sugcard__actions">
              <Button small variant="quiet" loading={busy === 'withdraw'} onClick={() => answer('withdraw')}>
                {t('Cancelar sugestão')}
              </Button>
            </div>
          ) : null}
        </>
      ) : message.mine ? (
        <>
          <p className="sugcard__answer" role="status">
            {t('Aguardando {name}', { name: otherName })}
          </p>
          <div className="sugcard__actions">
            <Button small variant="quiet" loading={busy === 'withdraw'} onClick={() => answer('withdraw')}>
              {t('Cancelar sugestão')}
            </Button>
          </div>
        </>
      ) : (
        <div className="sugcard__actions">
          <Button small loading={busy === 'accept'} disabled={busy === 'decline'} onClick={() => (replaces ? setConfirmAccept(true) : void answer('accept'))}>
            {t('Aceitar')}
          </Button>
          <Button small variant="secondary" loading={busy === 'decline'} disabled={busy === 'accept'} onClick={() => answer('decline')}>
            {t('Recusar')}
          </Button>
          {onSuggestOther ? (
            <Button small variant="quiet" disabled={busy !== undefined} onClick={onSuggestOther}>
              {t('Sugerir outro')}
            </Button>
          ) : null}
        </div>
      )}
      {problem ? <p className="sugcard__problem">{problem}</p> : null}
      {confirmAccept && replaces ? (
        <Sheet title={t('Trocar o local combinado?')} onClose={() => setConfirmAccept(false)}>
          <Confirm
            question={t('{place} já está aceito. Aceitar {next} cancela o aceite de {place}.', { place: replaces.name, next: card.venueName })}
            confirmLabel={t('Aceitar e trocar')}
            busy={busy === 'accept'}
            onCancel={() => setConfirmAccept(false)}
            onConfirm={() => {
              setConfirmAccept(false);
              void answer('accept');
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

interface SheetProps {
  inviteId: string;
  conversationId: string;
  otherName: string;
  title: string;
  /** Local já aceito na conversa: sugerir outro pede confirmação, porque o aceite do novo cancela este. */
  agreedName?: string | undefined;
  /** Já abre a busca "Sugerir outro lugar" (vindo da página do NOW). */
  searchOpen?: boolean;
  /** Mensagens já carregadas da conversa: marcam na lista os locais com sugestão ainda sem resposta. */
  messages?: readonly ChatMessage[];
  /** Quando o encontro do NOW começou: sugestões de antes são de outro encontro. */
  since?: string;
  onClose: () => void;
  onSent: (message: ChatMessage) => void;
}

/** Mesmo lugar: a mesma chave da busca ou o mesmo nome a menos de ~50 m (a chave pode mudar entre buscas). */
function samePlace(card: Pick<SuggestionCard, 'externalId' | 'venueName' | 'lat' | 'lng'>, item: Pick<SuggestionItem, 'key' | 'venueName' | 'lat' | 'lng'>): boolean {
  if (card.externalId === item.key) return true;
  return card.venueName.trim().toLowerCase() === item.venueName.trim().toLowerCase() && Math.abs(card.lat - item.lat) < 0.0005 && Math.abs(card.lng - item.lng) < 0.0005;
}

/** Lugar achado na busca "Sugerir outro lugar" vira um cartão de sugestão. */
function placeCard(p: ExplorePlace): SuggestionCard {
  return { source: p.source === 'ASKOUT' ? 'PLACE' : p.source, title: p.name, venueName: p.name, lat: p.lat, lng: p.lng, startsAt: null, endsAt: null, sample: p.sample, externalId: p.key };
}

/**
 * Mapa dentro do chat: vocês dois e os locais entre vocês, com a lista em rolagem horizontal logo abaixo.
 * Tocar um pin leva ao cartão; tocar um cartão destaca o pin. Daqui também se pesquisa qualquer outro lugar.
 */
export function SuggestionsSheet({ inviteId, conversationId, otherName, title, agreedName, searchOpen = false, messages = [], since, onClose, onSent }: SheetProps) {
  const match = useAsync(() => api.flashMatch(inviteId), [inviteId]);
  const [radiusKm, setRadiusKm] = useState<number | null>(() => nowRadiusKm());
  const result = useAsync(() => api.flashSuggestions(inviteId, radiusKm), [inviteId, radiusKm]);
  const [sending, setSending] = useState<string | undefined>();
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [picked, setPicked] = useState<string | undefined>();
  const [mapFailed, setMapFailed] = useState(false);

  const [pending, setPending] = useState<{ key: string; card: SuggestionCard } | undefined>();
  // Sugestões deste encontro ainda sem resposta: o local aparece marcado na lista e não é sugerido de novo.
  const open = messages.filter((m) => m.kind === 'SUGGESTION' && m.suggestion && m.response === null && (!since || m.createdAt >= since));
  const openFor = (item: SuggestionItem) => open.find((m) => m.suggestion && samePlace(m.suggestion, item));

  function send(key: string, card: SuggestionCard) {
    if (agreedName) setPending({ key, card });
    else void deliver(key, card);
  }

  async function deliver(key: string, card: SuggestionCard) {
    setPending(undefined);
    setSending(key);
    setError(undefined);
    try {
      const message = await api.sendSuggestion(conversationId, card);
      setSent((current) => new Set(current).add(key));
      onSent(message);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setSending(undefined);
    }
  }


  const data = result.data;
  const baseItems = sortByFairness(data?.items ?? []).slice(0, MAX_PLACES_ON_MAP);
  const more = useMorePlaces(inviteId, data?.radiusM, baseItems.map((i) => i.key));
  const items = [...baseItems, ...more.items];
  const hasOsm = items.some((i) => i.source === 'OSM');
  const hasGoogle = items.some((i) => i.source === 'GOOGLE');
  const m = match.data;
  const me = m?.me ? { lat: m.me.lat, lng: m.me.lng } : undefined;
  const them = m?.them ? [{ id: inviteId, lat: m.them.lat, lng: m.them.lng, stale: m.them.stale, initials: initials(otherName), photoUrl: m.other.avatarUrl }] : [];
  const mePhoto = useUser().profile.avatarUrl;
  const pins: PlacePin[] = items.map((p) => ({ key: p.key, name: placeName(p), lat: p.lat, lng: p.lng }));
  const dest = m?.destination ? { lat: m.destination.lat, lng: m.destination.lng, name: m.destination.name } : undefined;

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted sheet__lead">{t('Perto do ponto médio entre você e {otherName}, até {km} km.', { otherName, km: data ? Math.round(data.radiusM / 1000) : 3 })}</p>
      <div className="radiuschips" role="group" aria-label={t('Área de busca')}>
        {[null, ...NOW_RADIUS_CHOICES_KM].map((km) => (
          <button
            key={km ?? 'auto'}
            type="button"
            className={`chip${radiusKm === km ? ' chip--on' : ''}`}
            aria-pressed={radiusKm === km}
            onClick={() => {
              setRadiusKm(km);
              setNowRadiusKm(km);
            }}
          >
            {km === null ? t('Automático') : `${km} km`}
          </button>
        ))}
      </div>
      {open.length > 0 ? <p className="muted sheet__lead">{open.length === 1 ? t('1 sugestão ainda sem resposta no chat.') : t('{count} sugestões ainda sem resposta no chat.', { count: open.length })}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!mapFailed && (me || them.length > 0) ? (
        <Suspense fallback={<div className="matchmap matchmap--chat matchmap--loading"><RingLoader size={56} label={t('Carregando o mapa')} /></div>}>
          <div className="chatmap">
            <MatchMap me={me} mePhoto={mePhoto} others={them} places={pins} selectedKey={picked} onPick={setPicked} destination={dest} onFail={() => setMapFailed(true)} />
          </div>
        </Suspense>
      ) : null}
      {result.loading && !data ? <Loading label={t('Buscando locais')} /> : null}
      {result.error && !data ? (
        result.error.code === 'CONFLICT' ? (
          <Notice>{t('Os dois precisam compartilhar a localização no encontro para ver sugestões perto de vocês.')}</Notice>
        ) : (
          <Notice tone="error">{result.error.message}</Notice>
        )
      ) : null}
      {data && data.reason === null && items.length === 0 ? <Notice>{t('Nenhum evento ou local encontrado por perto agora.')}</Notice> : null}
      <PlaceCarousel
        items={items}
        otherName={otherName}
        picked={picked}
        onPick={setPicked}
        more={data && data.items.length > 0 ? more : undefined}
        action={(item) => {
          const already = openFor(item);
          if (already) {
            return (
              <span className="tag tag--open" role="status">
                {already.mine ? t('Sugestão aberta · aguardando {name}', { name: otherName }) : t('{name} sugeriu · responda no chat', { name: otherName })}
              </span>
            );
          }
          return (
            <Button small loading={sending === item.key} disabled={sent.has(item.key) || sending !== undefined} onClick={() => send(item.key, toCard(item))}>
              {sent.has(item.key) ? t('Enviado') : t('Sugerir')}
            </Button>
          );
        }}
      />
      {data && !data.placesAvailable ? <p className="muted sheet__foot">{t('Não foi possível buscar locais agora. Mostrando só eventos do AskouT.')}</p> : null}
      {hasGoogle ? <p className="muted sheet__foot">{t('Notas, fotos e lugares: Google.')}</p> : null}
      {hasOsm ? <p className="muted sheet__foot">{t('Lugares: © colaboradores do OpenStreetMap.')}</p> : null}
      {pending && agreedName ? (
        <Sheet title={t('Sugerir outro local?')} onClose={() => setPending(undefined)}>
          <ReplaceConfirm place={agreedName} next={pending.card.venueName} otherName={otherName} onCancel={() => setPending(undefined)} onConfirm={() => void deliver(pending.key, pending.card)} />
        </Sheet>
      ) : null}
      <MatchPlaceSearch center={me ?? (them[0] ? { lat: them[0].lat, lng: them[0].lng } : undefined)} otherName={otherName} busy={sending !== undefined} startOpen={searchOpen} onSuggest={(place) => void send(place.key, placeCard(place))} />
    </Sheet>
  );
}

/**
 * Mapa em modal, aberto pelo "Ver no mapa" do chat ou pela miniatura de um cartão: a sua localização, a do amigo
 * e o local (o combinado entre vocês ou o do cartão tocado). Sem encontro NOW ativo, mostra só o local.
 */
export function PlaceMapSheet({ inviteId, otherName, place, onClose }: { inviteId: string | undefined; otherName: string; place: { name: string; lat: number; lng: number } | undefined; onClose: () => void }) {
  const match = useAsync(() => (inviteId ? api.flashMatch(inviteId) : Promise.resolve(undefined)), [inviteId]);
  const [mapFailed, setMapFailed] = useState(false);
  const m = match.data;
  const me = m?.me ? { lat: m.me.lat, lng: m.me.lng } : undefined;
  const them = m?.them && inviteId ? [{ id: inviteId, lat: m.them.lat, lng: m.them.lng, stale: m.them.stale, initials: initials(otherName), photoUrl: m.other.avatarUrl }] : [];
  const mePhoto = useUser().profile.avatarUrl;
  // Sem local vindo do cartão, vale o lugar combinado no encontro.
  const target = place ?? (m?.destination ? { name: m.destination.name, lat: m.destination.lat, lng: m.destination.lng } : undefined);
  const waiting = inviteId !== undefined && match.loading && !m;
  return (
    <Sheet title={target ? target.name : t('Ver no mapa')} onClose={onClose}>
      {waiting ? <Loading label={t('Carregando o mapa')} /> : null}
      {!waiting && !mapFailed && (target || me || them.length > 0) ? (
        <Suspense fallback={<div className="matchmap matchmap--modal matchmap--loading"><RingLoader size={56} label={t('Carregando o mapa')} /></div>}>
          <div className="placemap">
            <MatchMap me={me} mePhoto={mePhoto} others={them} destination={target} onFail={() => setMapFailed(true)} />
          </div>
        </Suspense>
      ) : null}
      {mapFailed ? <Notice tone="error">{t('Não foi possível carregar o mapa agora.')}</Notice> : null}
      {!waiting ? (
        <ul className="placemap__legend">
          {me ? <li><span className="pin pin--me placemap__dot" aria-hidden="true" /> {t('Você')}</li> : null}
          {them.length > 0 ? <li><span className="pin pin--them placemap__dot" aria-hidden="true" /> {otherName}</li> : null}
          {target ? <li><span aria-hidden="true">★</span> {target.name}</li> : <li className="muted">{t('Vocês ainda não marcaram um local.')}</li>}
        </ul>
      ) : null}
      {!waiting && inviteId && (!me || them.length === 0) ? <p className="muted sheet__foot">{t('A localização aparece quando cada um compartilha no encontro NOW.')}</p> : null}
      {target ? (
        <div className="row-actions">
          <OpenInMaps className="btn btn--secondary btn--small" mode="route" lat={target.lat} lng={target.lng} label={target.name}>
            {t('Rota até lá')}
          </OpenInMaps>
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * Cartões dos locais entre vocês em rolagem horizontal, numerados como os pins do mapa (chat e página do encontro).
 * Tocar um cartão destaca o pin; escolher um pin no mapa traz o cartão para a vista.
 */
export function PlaceCarousel({ items, otherName, picked, onPick, action, more }: { items: readonly SuggestionItem[]; otherName: string; picked: string | undefined; onPick: (key: string) => void; action: (item: SuggestionItem) => ReactNode; more?: MorePlaces | undefined }) {
  const slides = useRef(new Map<string, HTMLLIElement>());
  const now = new Date();
  useEffect(() => {
    if (picked) slides.current.get(picked)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }, [picked]);
  if (items.length === 0) return null;
  return (
    <ul className="carousel" aria-label={t('Lugares entre vocês')}>
      {items.map((item, index) => (
        <li
          key={item.key}
          className="carousel__slide"
          ref={(el) => {
            if (el) slides.current.set(item.key, el);
            else slides.current.delete(item.key);
          }}
        >
          <article className={`sugcard${picked === item.key ? ' sugcard--picked' : ''}`} onClick={() => onPick(item.key)}>
            {item.photoPath ? <PlacePhoto path={item.photoPath} author={item.photoAuthor} /> : null}
            <div className="sugcard__tags">
              <span className="sugcard__num" aria-hidden="true">{index + 1}</span>
              <SourceTag source={item.source} />
              {item.sample ? <SampleBadge /> : null}
            </div>
            <h3 className="sugcard__title">{item.title}</h3>
            {item.venueName !== item.title ? (
              <p className="sugcard__venue">
                <VenueLink venueId={item.venueId} name={item.venueName} />
              </p>
            ) : null}
            {item.rating !== null ? <Rating rating={item.rating} count={item.ratingCount} /> : null}
            <p className="sugcard__when">{formatWhen(item.startsAt, item.endsAt, now)}</p>
            <p className="sugcard__dist">{formatDistances(item, otherName)}</p>
            <div className="sugcard__actions">
              {action(item)}
              <OpenInMaps className="btn btn--quiet btn--small" mode="route" lat={item.lat} lng={item.lng} label={item.venueName}>
                {t('Rota')}
              </OpenInMaps>
              <OpenInMaps className="btn btn--quiet btn--small" lat={item.lat} lng={item.lng} label={item.venueName} googleUrl={item.mapsUri}>
                {t('Mapa')}
              </OpenInMaps>
            </div>
          </article>
        </li>
      ))}
      {more && more.canLoad ? (
        <li className="carousel__slide carousel__slide--more">
          <button type="button" className="sugcard sugcard--more" onClick={more.load} disabled={more.loading}>
            {more.loading ? <RingLoader size={40} label={t('Buscando locais')} /> : <span className="sugcard--more__plus" aria-hidden="true">+</span>}
            <strong>{t('Ver mais')}</strong>
            <span className="muted">{more.nextKm ? t('Buscar até {km} km do meio do caminho', { km: more.nextKm }) : null}</span>
            {more.error ? <span className="sugcard__problem">{more.error}</span> : null}
          </button>
        </li>
      ) : null}
      {more && more.empty ? (
        <li className="carousel__slide carousel__slide--more">
          <p className="sugcard sugcard--more muted">{t('Nenhum outro local numa área maior.')}</p>
        </li>
      ) : null}
    </ul>
  );
}

export interface MorePlaces {
  items: SuggestionItem[];
  nextKm: number | undefined;
  canLoad: boolean;
  loading: boolean;
  empty: boolean;
  error: string | undefined;
  load: () => void;
}

/**
 * "Ver mais" no fim dos lugares entre vocês: cada toque busca no próximo raio maior (até 50 km),
 * só o que fica além do que já aparece, e junta à lista e ao mapa. Recomeça quando a busca base muda.
 */
export function useMorePlaces(inviteId: string, baseRadiusM: number | undefined, baseKeys: readonly string[]): MorePlaces {
  const [state, setState] = useState<{ base: number | undefined; outerKm: number | undefined; items: SuggestionItem[]; loading: boolean; empty: boolean; error: string | undefined }>({ base: undefined, outerKm: undefined, items: [], loading: false, empty: false, error: undefined });
  const current = state.base === baseRadiusM ? state : { base: baseRadiusM, outerKm: undefined, items: [], loading: false, empty: false, error: undefined };
  if (current !== state) setState(current);
  const outerKm = current.outerKm ?? (baseRadiusM ? baseRadiusM / 1000 : undefined);
  const nextKm = outerKm !== undefined ? nextRadiusKm(outerKm) : undefined;
  async function load() {
    if (!nextKm || outerKm === undefined || current.loading) return;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const r = await api.flashSuggestions(inviteId, nextKm, outerKm);
      setState((s) => {
        const seen = new Set([...baseKeys, ...s.items.map((i) => i.key)]);
        const fresh = sortByFairness(r.items.filter((i) => !seen.has(i.key)));
        return { ...s, outerKm: nextKm, items: [...s.items, ...fresh], loading: false, empty: fresh.length === 0 && nextRadiusKm(nextKm) === undefined };
      });
    } catch (failure) {
      setState((s) => ({ ...s, loading: false, error: toApiError(failure).message }));
    }
  }
  return { items: current.items, nextKm, canLoad: baseRadiusM !== undefined && nextKm !== undefined, loading: current.loading, empty: current.empty, error: current.error, load: () => void load() };
}

/** Aviso antes de sugerir outro local quando já há um aceito: se o amigo aceitar o novo, o anterior deixa de valer. */
export function ReplaceConfirm({ place, next, otherName, busy, onConfirm, onCancel }: { place: string; next: string; otherName: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Confirm
      question={t('Vocês já combinaram {place}. Se {name} aceitar {next}, o aceite de {place} é cancelado.', { place, next, name: otherName })}
      confirmLabel={t('Sugerir mesmo assim')}
      busy={busy ?? false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
