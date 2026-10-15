import { VenueLink } from './venue-link.tsx';
import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { formatDistances, formatRating, formatWhen, mapLink, ratingLabel, routeLink, sourceLabel, starPercent, toCard } from '../lib/chat.ts';
import { formatDistance } from '../lib/flash.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, SuggestionCard, SuggestionItem } from '../lib/types.ts';
import { Sheet } from './agenda.tsx';
import { Button, Loading, Notice } from './ui.tsx';

/** Selo de dado de exemplo: o app nunca apresenta como real o que foi criado para teste. */
export function SampleBadge() {
  return <span className="tag tag--sample">Exemplo de teste</span>;
}

function SourceTag({ source }: { source: SuggestionCard['source'] }) {
  return <span className={`tag tag--${source === 'EVENT' ? 'event' : source === 'GOOGLE' ? 'google' : 'osm'}`}>{sourceLabel(source)}</span>;
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
      <figcaption>Foto: {author ? `${author} · ` : ''}Google</figcaption>
    </figure>
  );
}

function Distances({ distances, otherName }: { distances: { meM: number; themM: number }; otherName: string }) {
  return (
    <ul className="sugcard__routes" aria-label="Distância até o lugar, em linha reta">
      <li>
        <strong>Você</strong> a {formatDistance(distances.meM)}
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
  const [busy, setBusy] = useState<'accept' | 'decline' | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  async function answer(action: 'accept' | 'decline') {
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
      <div className="sugcard__tags">
        <SourceTag source={card.source} />
        {card.sample ? <SampleBadge /> : null}
      </div>
      <p className="sugcard__title">{card.title}</p>
      {card.venueName !== card.title ? <p className="sugcard__venue">{card.venueName}</p> : null}
      <p className="sugcard__when">{formatWhen(card.startsAt, card.endsAt, new Date(nowIso))}</p>
      {message.distances ? <Distances distances={message.distances} otherName={otherName} /> : null}
      <div className="sugcard__links">
        <a href={routeLink(card.lat, card.lng)} target="_blank" rel="noopener noreferrer">
          Rota até lá
        </a>
        <a href={mapLink(card.lat, card.lng)} target="_blank" rel="noopener noreferrer">
          Ver no mapa
        </a>
      </div>
      {message.response ? (
        <p className={`sugcard__answer sugcard__answer--${message.response === 'ACCEPTED' ? 'yes' : 'no'}`} role="status">
          {message.response === 'ACCEPTED' ? (message.mine ? `${otherName} aceitou` : 'Você aceitou') : message.mine ? `${otherName} recusou` : 'Você recusou'}
        </p>
      ) : message.mine ? (
        <p className="sugcard__answer" role="status">
          Aguardando {otherName}
        </p>
      ) : (
        <div className="sugcard__actions">
          <Button small loading={busy === 'accept'} disabled={busy === 'decline'} onClick={() => answer('accept')}>
            Aceitar
          </Button>
          <Button small variant="secondary" loading={busy === 'decline'} disabled={busy === 'accept'} onClick={() => answer('decline')}>
            Recusar
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
  onClose: () => void;
  onSent: (message: ChatMessage) => void;
}

/** Mini carrossel com eventos e lugares perto do ponto médio entre vocês dois. */
export function SuggestionsSheet({ inviteId, conversationId, otherName, onClose, onSent }: SheetProps) {
  const result = useAsync(() => api.flashSuggestions(inviteId), [inviteId]);
  const [sending, setSending] = useState<string | undefined>();
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const now = new Date();

  async function send(item: SuggestionItem) {
    setSending(item.key);
    setError(undefined);
    try {
      const message = await api.sendSuggestion(conversationId, toCard(item));
      setSent((current) => new Set(current).add(item.key));
      onSent(message);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setSending(undefined);
    }
  }

  const data = result.data;
  const hasOsm = data?.items.some((i) => i.source === 'OSM') ?? false;
  const hasGoogle = data?.items.some((i) => i.source === 'GOOGLE') ?? false;

  return (
    <Sheet title="Sugerir um lugar" onClose={onClose}>
      <p className="muted sheet__lead">Perto do ponto médio entre você e {otherName}, até {data ? Math.round(data.radiusM / 1000) : 3} km.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result.loading && !data ? <Loading label="Buscando lugares" /> : null}
      {result.error && !data ? (
        result.error.code === 'CONFLICT' ? (
          <Notice>Os dois precisam compartilhar a localização no encontro para ver sugestões perto de vocês.</Notice>
        ) : (
          <Notice tone="error">{result.error.message}</Notice>
        )
      ) : null}
      {data?.reason === 'TOO_FAR' ? <Notice>Vocês estão longe demais um do outro para achar algo no meio do caminho.</Notice> : null}
      {data && data.reason === null && data.items.length === 0 ? (
        <Notice>Nenhum evento ou lugar encontrado por perto agora.</Notice>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className="carousel" aria-label="Sugestões">
          {data.items.map((item) => (
            <li key={item.key} className="carousel__slide">
              <article className="sugcard">
                {item.photoPath ? <PlacePhoto path={item.photoPath} author={item.photoAuthor} /> : null}
                <div className="sugcard__tags">
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
                  <Button small loading={sending === item.key} disabled={sent.has(item.key) || sending !== undefined} onClick={() => send(item)}>
                    {sent.has(item.key) ? 'Enviado' : 'Sugerir'}
                  </Button>
                  <a className="btn btn--quiet btn--small" href={routeLink(item.lat, item.lng)} target="_blank" rel="noopener noreferrer">
                    Rota
                  </a>
                  <a className="btn btn--quiet btn--small" href={item.mapsUri ?? mapLink(item.lat, item.lng)} target="_blank" rel="noopener noreferrer">
                    Mapa
                  </a>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
      {data && !data.placesAvailable ? <p className="muted sheet__foot">Não foi possível buscar lugares agora. Mostrando só eventos do AskouT.</p> : null}
      {hasGoogle ? <p className="muted sheet__foot">Notas, fotos e lugares: Google.</p> : null}
      {hasOsm ? <p className="muted sheet__foot">Lugares: © colaboradores do OpenStreetMap.</p> : null}
    </Sheet>
  );
}
