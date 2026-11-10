import { VenueLink } from './venue-link.tsx';
import { shareOrigin } from '../lib/public-origin.ts';
import { trackShare } from './dwell.tsx';
import { useEffect, useState } from 'react';
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
      sentToast={(names) => (names.length === 1 ? t('Evento enviado para: {name}', { name: names[0]! }) : t('Evento enviado para: {name} e mais {n}', { name: names[0]!, n: names.length - 1 }))}
      actions={actions}
      note={note}
      onClose={onClose}
    />
  );
}

/**
 * Compartilhar um evento a partir de um post (Início, perfil): mesmo comportamento da página do evento — na conversa vai
 * o cartão do evento, não um link. Busca a página do evento para saber se já foi repostado e se é privado.
 */
export function ShareEventPostSheet({ eventId, title, mine, onClose }: { eventId: string; title: string; mine: boolean; onClose: () => void }) {
  const [page, setPage] = useState<{ source: 'PLACE' | 'USER'; isOwner: boolean; isPrivate: boolean; postedByMe: boolean } | undefined>();
  const [posted, setPosted] = useState<boolean | undefined>();
  useEffect(() => {
    let cancelled = false;
    api.eventPage(eventId).then(
      (p) => {
        if (!cancelled) setPage({ source: p.source, isOwner: p.isOwner, isPrivate: p.isPrivate === true, postedByMe: p.postedByMe });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  const source = page?.source ?? 'USER';
  const isOwner = page?.isOwner ?? mine;
  const isPrivate = page?.isPrivate ?? false;
  return (
    <ShareEventSheet
      eventId={eventId}
      source={source}
      title={title}
      posted={posted ?? page?.postedByMe ?? false}
      onPostedChange={setPosted}
      profile={source === 'PLACE' ? 'toggle' : isPrivate ? 'private' : isOwner ? 'owner' : 'toggle'}
      outside={!isPrivate}
      onClose={onClose}
    />
  );
}

/** Cartão do evento dentro da conversa. */
export function EventBubble({ event }: { event: EventCard }) {
  const [failed, setFailed] = useState(false);
  // O cartão traz só capas públicas; foto do Google (assinada) só a página do evento entrega. Sem capa no cartão, busca lá.
  const cardImage = safeImage(event.imageUrl);
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (cardImage) return;
    let cancelled = false;
    api.eventPage(event.id).then(
      (page) => {
        if (!cancelled && page.coverPath) setFetched(page.coverPath.startsWith('/') ? api.assetUrl(page.coverPath) : safeImage(page.coverPath));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [event.id, cardImage]);
  const image = failed ? null : (cardImage ?? fetched);
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
      <span className="evbubble__cta">{t('Ver evento')}</span>
    </Link>
  );
}
