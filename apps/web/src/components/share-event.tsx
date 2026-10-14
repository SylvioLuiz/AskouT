import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { Avatar, Button, ErrorState, GroupAvatar, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { eventLink, eventShareText } from '../lib/share.ts';
import type { ConversationItem, EventCard } from '../lib/types.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatWhen } from '../lib/chat.ts';
import { Link } from '../router.tsx';

type Step = 'menu' | 'chat';

/** Compartilhar um evento: no perfil (feed), numa conversa, ou fora do app. */
export function ShareEventSheet({ eventId, title, posted, onPostedChange, onClose }: { eventId: string; title: string; posted: boolean; onPostedChange: (posted: boolean) => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const chats = useAsync(() => (step === 'chat' ? api.conversations() : Promise.resolve(null)), [step]);

  async function togglePost() {
    setBusy(true);
    setMessage(undefined);
    try {
      if (posted) await api.unpostEvent(eventId);
      else await api.postEvent(eventId);
      onPostedChange(!posted);
      setMessage({ tone: 'ok', text: posted ? 'Evento tirado do seu perfil.' : 'Evento postado no seu perfil.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  async function sendTo(conversation: ConversationItem) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.sendEvent(conversation.id, eventId);
      setMessage({ tone: 'ok', text: `Enviado para ${conversation.type === 'GROUP' ? (conversation.name ?? 'o grupo') : (conversation.other?.username ?? 'a conversa')}.` });
      setStep('menu');
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  async function outside() {
    setMessage(undefined);
    const url = eventLink(window.location.origin, eventId);
    const text = eventShareText(title);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'ok', text: 'Link copiado. Cole onde quiser, por exemplo no WhatsApp.' });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: `Não foi possível copiar. O link é ${url}` });
    }
  }

  const sendable = (chats.data?.items ?? []).filter((c) => c.canSend);

  return (
    <Sheet title="Compartilhar" onClose={onClose}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {step === 'menu' ? (
        <ul className="sharelist">
          <li>
            <button type="button" className="sharelist__item" onClick={togglePost} disabled={busy}>
              <strong>{posted ? 'Tirar do meu perfil' : 'Postar no meu perfil'}</strong>
              <span>{posted ? 'O evento deixa de aparecer na sua grade.' : 'Aparece na grade do seu perfil para quem pode ver.'}</span>
            </button>
          </li>
          <li>
            <button type="button" className="sharelist__item" onClick={() => setStep('chat')} disabled={busy}>
              <strong>Enviar em uma conversa</strong>
              <span>Mande para um amigo ou um grupo.</span>
            </button>
          </li>
          <li>
            <button type="button" className="sharelist__item" onClick={outside} disabled={busy}>
              <strong>Fora do app</strong>
              <span>WhatsApp, redes sociais ou copiar o link.</span>
            </button>
          </li>
        </ul>
      ) : (
        <>
          {chats.loading && !chats.data ? <Loading /> : null}
          {chats.error ? <ErrorState message={chats.error.message} onRetry={chats.reload} /> : null}
          {chats.data && sendable.length === 0 ? <p className="muted">Você ainda não tem conversas. Siga alguém que também te segue para conversar.</p> : null}
          <ul className="sharelist">
            {sendable.map((c) => (
              <li key={c.id}>
                <button type="button" className="sharelist__item sharelist__item--person" onClick={() => sendTo(c)} disabled={busy}>
                  {c.type === 'GROUP' ? <GroupAvatar name={c.name ?? 'Grupo'} size={40} imageUrl={c.imageUrl} /> : c.other ? <Avatar profile={c.other} size={40} /> : null}
                  <strong>{c.type === 'GROUP' ? (c.name ?? 'Grupo') : (c.other?.username ?? 'Conversa')}</strong>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="quiet" small onClick={() => setStep('menu')}>
            Voltar
          </Button>
        </>
      )}
    </Sheet>
  );
}

/** Cartão do evento dentro da conversa. */
export function EventBubble({ event }: { event: EventCard }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="evbubble">
      <span className={`evcover evcover--wide evcover--${event.kind.toLowerCase()}`}>
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="evcover__kind" aria-hidden="true">{kindLabel(event.kind)}</span>}
      </span>
      <strong className="evbubble__title">{event.title}</strong>
      <span className="evbubble__sub">{formatWhen(event.startsAt, event.endsAt, new Date())}</span>
      <span className="evbubble__sub">{event.venueName}</span>
      {event.sample ? <span className="tag tag--sample">Exemplo de teste</span> : null}
    </Link>
  );
}
