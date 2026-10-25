import { VenueLink } from './venue-link.tsx';
import { trackShare } from './dwell.tsx';
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
import { t } from '../lib/i18n/index.ts';

type Step = 'menu' | 'chat';

/** Compartilhar um evento: no perfil (feed), numa conversa, ou fora do app. */
export function ShareEventSheet({ eventId, source = 'PLACE', title, posted, onPostedChange, profile = 'toggle', outside: allowOutside = true, onClose }: { eventId: string; source?: 'PLACE' | 'USER'; title: string; posted: boolean; onPostedChange: (posted: boolean) => void; profile?: 'toggle' | 'owner' | 'private'; outside?: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const chats = useAsync(() => (step === 'chat' ? api.conversations() : Promise.resolve(null)), [step]);

  /** Conta como compartilhamento para as recomendações (evento de local é EVENT; evento de pessoa é um post). */
  const shared = () => trackShare(source === 'USER' ? 'POST' : 'EVENT', eventId);

  async function togglePost() {
    setBusy(true);
    setMessage(undefined);
    try {
      if (posted) await api.unpostEvent(eventId);
      else await api.postEvent(eventId);
      onPostedChange(!posted);
      if (!posted) shared();
      setMessage({ tone: 'ok', text: posted ? t('Evento tirado do seu perfil.') : t('Evento postado no seu perfil.') });
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
      shared();
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
        shared();
        return;
      }
      await navigator.clipboard.writeText(url);
      shared();
      setMessage({ tone: 'ok', text: t('Link copiado. Cole onde quiser, por exemplo no WhatsApp.') });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: t('Não foi possível copiar. O link é {url}', { url }) });
    }
  }

  const sendable = (chats.data?.items ?? []).filter((c) => c.canSend);

  return (
    <Sheet title={t('Compartilhar')} onClose={onClose}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {step === 'menu' ? (
        <ul className="sharelist">
          {profile === 'toggle' ? (
            <li>
              <button type="button" className="sharelist__item" onClick={togglePost} disabled={busy}>
                <strong>{posted ? t('Tirar do meu perfil') : t('Postar no meu perfil')}</strong>
                <span>{posted ? t('O evento deixa de aparecer na sua grade.') : t('Aparece na grade do seu perfil para quem pode ver.')}</span>
              </button>
            </li>
          ) : (
            <li>
              <p className="muted sharelist__note">{profile === 'private' ? t('Evento privado: só vai para as conversas que você escolher, e ninguém posta no perfil.') : t('Seu evento já aparece na aba Eventos do seu perfil.')}</p>
            </li>
          )}
          <li>
            <button type="button" className="sharelist__item" onClick={() => setStep('chat')} disabled={busy}>
              <strong>{t('Enviar em uma conversa')}</strong>
              <span>{t('Mande para um amigo ou um grupo.')}</span>
            </button>
          </li>
          {allowOutside ? (
            <li>
              <button type="button" className="sharelist__item" onClick={outside} disabled={busy}>
                <strong>{t('Fora do app')}</strong>
                <span>{t('WhatsApp, redes sociais ou copiar o link.')}</span>
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <>
          {chats.loading && !chats.data ? <Loading /> : null}
          {chats.error ? <ErrorState message={chats.error.message} onRetry={chats.reload} /> : null}
          {chats.data && sendable.length === 0 ? <p className="muted">{t('Você ainda não tem conversas. Siga alguém que também te segue para conversar.')}</p> : null}
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
            {t('Voltar')}
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
      {event.venueName ? (
        <span className="evbubble__sub">
          <VenueLink venueId={event.venueId} name={event.venueName} nested />
        </span>
      ) : null}
      {event.going ? <span className="evbubble__going">{t('Você vai')}</span> : null}
      {event.sample ? <span className="tag tag--sample">{t('Exemplo de teste')}</span> : null}
    </Link>
  );
}
