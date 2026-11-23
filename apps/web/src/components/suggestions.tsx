import { OpenInMaps } from './open-in-maps.tsx';
import { VenueLink } from './venue-link.tsx';
import { Suspense, useRef, useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { formatDistances, formatRating, formatWhen, ratingLabel, sourceLabel, starPercent, toCard } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, ExplorePlace, SuggestionCard } from '../lib/types.ts';
import { MAX_PLACES_ON_MAP, formatDistance, placeName, sortByFairness } from '../lib/flash.ts';
import { nowRadiusKm } from '../lib/now-radius.ts';
import { initials } from '../lib/avatar.ts';
import { lazyWithReload } from '../lib/chunk-reload.ts';
import type { PlacePin } from './match-map.tsx';
import { MatchPlaceSearch } from './match-place-search.tsx';
import { RingLoader } from './ring-loader.tsx';
import { Sheet } from './agenda.tsx';
import { Button, Loading, Notice } from './ui.tsx';
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
export function SuggestionBubble({ message, otherName, nowIso, conversationId, onUpdated }: { message: ChatMessage; otherName: string; nowIso: string; conversationId: string; onUpdated: (m: ChatMessage) => void }) {
  const card = message.suggestion as SuggestionCard;
  const [busy, setBusy] = useState<'accept' | 'decline' | 'cancel' | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  async function answer(action: 'accept' | 'decline' | 'cancel') {
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
      <Suspense fallback={<div className="minimap" aria-hidden="true" />}>
        <MiniPlaceMap lat={card.lat} lng={card.lng} name={card.venueName} />
      </Suspense>
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
        <OpenInMaps lat={card.lat} lng={card.lng} label={card.venueName}>
          {t('Ver no mapa')}
        </OpenInMaps>
      </div>
      {message.response ? (
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
        </>
      ) : message.mine ? (
        <p className="sugcard__answer" role="status">
          Aguardando {otherName}
        </p>
      ) : (
        <div className="sugcard__actions">
          <Button small loading={busy === 'accept'} disabled={busy === 'decline'} onClick={() => answer('accept')}>
            {t('Aceitar')}
          </Button>
          <Button small variant="secondary" loading={busy === 'decline'} disabled={busy === 'accept'} onClick={() => answer('decline')}>
            {t('Recusar')}
          </Button>
        </div>
      )}
      {problem ? <p className="sugcard__problem">{problem}</p> : null}
    </div>
  );
}

interface SheetProps {
  inviteId: string;
  conversationId: string;
  otherName: string;
  title: string;
  /** Já abre a busca "Sugerir outro lugar" (vindo da página do NOW). */
  searchOpen?: boolean;
  onClose: () => void;
  onSent: (message: ChatMessage) => void;
}

/** Lugar achado na busca "Sugerir outro lugar" vira um cartão de sugestão. */
function placeCard(p: ExplorePlace): SuggestionCard {
  return { source: p.source === 'ASKOUT' ? 'PLACE' : p.source, title: p.name, venueName: p.name, lat: p.lat, lng: p.lng, startsAt: null, endsAt: null, sample: p.sample, externalId: p.key };
}

/**
 * Mapa dentro do chat: vocês dois e os locais entre vocês, com a lista em rolagem horizontal logo abaixo.
 * Tocar um pin leva ao cartão; tocar um cartão destaca o pin. Daqui também se pesquisa qualquer outro lugar.
 */
export function SuggestionsSheet({ inviteId, conversationId, otherName, title, searchOpen = false, onClose, onSent }: SheetProps) {
  const match = useAsync(() => api.flashMatch(inviteId), [inviteId]);
  const result = useAsync(() => api.flashSuggestions(inviteId, nowRadiusKm()), [inviteId]);
  const [sending, setSending] = useState<string | undefined>();
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [picked, setPicked] = useState<string | undefined>();
  const [mapFailed, setMapFailed] = useState(false);
  const slides = useRef(new Map<string, HTMLLIElement>());
  const now = new Date();

  async function send(key: string, card: SuggestionCard) {
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

  function pickFromMap(key: string) {
    setPicked(key);
    slides.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }

  const data = result.data;
  const items = sortByFairness(data?.items ?? []).slice(0, MAX_PLACES_ON_MAP);
  const hasOsm = items.some((i) => i.source === 'OSM');
  const hasGoogle = items.some((i) => i.source === 'GOOGLE');
  const m = match.data;
  const me = m?.me ? { lat: m.me.lat, lng: m.me.lng } : undefined;
  const them = m?.them ? [{ id: inviteId, lat: m.them.lat, lng: m.them.lng, stale: m.them.stale, initials: initials(otherName) }] : [];
  const pins: PlacePin[] = items.map((p) => ({ key: p.key, name: placeName(p), lat: p.lat, lng: p.lng }));
  const dest = m?.destination ? { lat: m.destination.lat, lng: m.destination.lng, name: m.destination.name } : undefined;

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="muted sheet__lead">{t('Perto do ponto médio entre você e {otherName}, até {km} km.', { otherName, km: data ? Math.round(data.radiusM / 1000) : 3 })}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!mapFailed && (me || them.length > 0) ? (
        <Suspense fallback={<div className="matchmap matchmap--chat matchmap--loading"><RingLoader size={56} label={t('Carregando o mapa')} /></div>}>
          <div className="chatmap">
            <MatchMap me={me} others={them} places={pins} selectedKey={picked} onPick={pickFromMap} destination={dest} onFail={() => setMapFailed(true)} />
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
      {items.length > 0 ? (
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
              <article className={`sugcard${picked === item.key ? ' sugcard--picked' : ''}`} onClick={() => setPicked(item.key)}>
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
                  <Button small loading={sending === item.key} disabled={sent.has(item.key) || sending !== undefined} onClick={() => send(item.key, toCard(item))}>
                    {sent.has(item.key) ? t('Enviado') : t('Sugerir')}
                  </Button>
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
        </ul>
      ) : null}
      {data && !data.placesAvailable ? <p className="muted sheet__foot">{t('Não foi possível buscar locais agora. Mostrando só eventos do AskouT.')}</p> : null}
      {hasGoogle ? <p className="muted sheet__foot">{t('Notas, fotos e lugares: Google.')}</p> : null}
      {hasOsm ? <p className="muted sheet__foot">{t('Lugares: © colaboradores do OpenStreetMap.')}</p> : null}
      <MatchPlaceSearch center={me ?? (them[0] ? { lat: them[0].lat, lng: them[0].lng } : undefined)} otherName={otherName} busy={sending !== undefined} startOpen={searchOpen} onSuggest={(place) => void send(place.key, placeCard(place))} />
    </Sheet>
  );
}
