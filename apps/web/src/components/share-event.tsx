import { VenueLink } from './venue-link.tsx';
import { shareOrigin } from '../lib/public-origin.ts';
import { trackShare } from './dwell.tsx';
import { useState } from 'react';
import { CheckIcon, PlusIcon, RepostIcon } from './icons.tsx';
import { ShareSheet } from './share-sheet.tsx';
import type { ShareAction } from './share-sheet.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { eventLink, eventShareText } from '../lib/share.ts';
import type { EventCard } from '../lib/types.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatWhen } from '../lib/chat.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Compartilhar um evento: numa ou mais conversas (vai o cartão do evento), no perfil (feed) ou fora do app. */
export function ShareEventSheet({ eventId, source = 'PLACE', title, posted, onPostedChange, profile = 'toggle', outside: allowOutside = true, onClose }: { eventId: string; source?: 'PLACE' | 'USER'; title: string; posted: boolean; onPostedChange: (posted: boolean) => void; profile?: 'toggle' | 'owner' | 'private'; outside?: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  /** Conta como compartilhamento para as recomendações (evento de local é EVENT; evento de pessoa é um post). */
  const shared = () => trackShare(source === 'USER' ? 'POST' : 'EVENT', eventId);

  async function togglePost() {
    setBusy(true);
    setProblem(undefined);
    try {
      if (posted) await api.unpostEvent(eventId);
      else await api.postEvent(eventId);
      onPostedChange(!posted);
      if (!posted) shared();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function send(conversationId: string, message: string | undefined) {
    await api.sendEvent(conversationId, eventId);
    if (message) await api.sendText(conversationId, message);
  }

  const actions: ShareAction[] =
    profile === 'toggle'
      ? [
          source === 'USER'
            ? // Evento de pessoa repostado vai para o perfil e para o Início de quem segue você.
              { key: 'profile', label: posted ? t('Repostado') : t('Repostar'), icon: posted ? <CheckIcon /> : <RepostIcon />, on: posted, busy, onClick: () => void togglePost() }
            : { key: 'profile', label: posted ? t('No seu perfil') : t('Postar no perfil'), icon: posted ? <CheckIcon /> : <PlusIcon />, on: posted, busy, onClick: () => void togglePost() },
        ]
      : [];
  const note = problem ?? (profile === 'toggle' && source === 'USER' && !posted ? t('Repostar coloca o evento no seu perfil e no Início de quem segue você.') : profile === 'private' ? t('Evento privado: só vai para as conversas que você escolher, e ninguém posta no perfil.') : profile === 'owner' ? t('Seu evento já aparece na aba Eventos do seu perfil.') : undefined);

  return (
    <ShareSheet
      link={allowOutside ? { title, text: eventShareText(title), url: eventLink(shareOrigin(), eventId) } : undefined}
      send={send}
      onShared={shared}
      actions={actions}
      note={note}
      onClose={onClose}
    />
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
