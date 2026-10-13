import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { formatDistances, formatWhen, mapLink, sourceLabel, toCard } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, SuggestionCard, SuggestionItem } from '../lib/types.ts';
import { Sheet } from './agenda.tsx';
import { Button, Loading, Notice } from './ui.tsx';

/** Selo de dado de exemplo: o app nunca apresenta como real o que foi criado para teste. */
export function SampleBadge() {
  return <span className="tag tag--sample">Exemplo de teste</span>;
}

function SourceTag({ source }: { source: SuggestionCard['source'] }) {
  return <span className={`tag tag--${source === 'EVENT' ? 'event' : 'osm'}`}>{sourceLabel(source)}</span>;
}

/** O cartão dentro de uma mensagem da conversa. */
export function SuggestionBubble({ card, nowIso }: { card: SuggestionCard; nowIso: string }) {
  return (
    <div className="sugcard sugcard--inline">
      <div className="sugcard__tags">
        <SourceTag source={card.source} />
        {card.sample ? <SampleBadge /> : null}
      </div>
      <p className="sugcard__title">{card.title}</p>
      {card.venueName !== card.title ? <p className="sugcard__venue">{card.venueName}</p> : null}
      <p className="sugcard__when">{formatWhen(card.startsAt, card.endsAt, new Date(nowIso))}</p>
      <a className="sugcard__map" href={mapLink(card.lat, card.lng)} target="_blank" rel="noopener noreferrer">
        Ver no mapa
      </a>
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
                <div className="sugcard__tags">
                  <SourceTag source={item.source} />
                  {item.sample ? <SampleBadge /> : null}
                </div>
                <h3 className="sugcard__title">{item.title}</h3>
                {item.venueName !== item.title ? <p className="sugcard__venue">{item.venueName}</p> : null}
                <p className="sugcard__when">{formatWhen(item.startsAt, item.endsAt, now)}</p>
                <p className="sugcard__dist">{formatDistances(item, otherName)}</p>
                <div className="sugcard__actions">
                  <Button small loading={sending === item.key} disabled={sent.has(item.key) || sending !== undefined} onClick={() => send(item)}>
                    {sent.has(item.key) ? 'Enviado' : 'Sugerir'}
                  </Button>
                  <a className="btn btn--quiet btn--small" href={mapLink(item.lat, item.lng)} target="_blank" rel="noopener noreferrer">
                    Ver no mapa
                  </a>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
      {data && !data.osmAvailable ? <p className="muted sheet__foot">Não foi possível buscar lugares do OpenStreetMap agora. Mostrando só eventos do AskouT.</p> : null}
      {hasOsm ? <p className="muted sheet__foot">Lugares: © colaboradores do OpenStreetMap.</p> : null}
    </Sheet>
  );
}
