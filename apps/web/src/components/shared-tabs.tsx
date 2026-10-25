import { VenueLink } from './venue-link.tsx';
import { MeetupCover } from './meetup.tsx';
import { MediaThumb } from './chat-media.tsx';
import { VoiceBubble } from './voice.tsx';
import { Button, EmptyState } from './ui.tsx';
import type { ChatMessage, MeetupView, SharedLink, SharedMedia as SharedMediaItem, SharedVoice } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function GroupEvent({ meetup, onManage }: { meetup: MeetupView; onManage?: () => void }) {
  const start = new Date(meetup.startsAt);
  const body = (
    <>
      <MeetupCover meetup={meetup} />
      <div className="groupevent__body">
        <h3 className="groupevent__title">{meetup.title}</h3>
        {meetup.status === 'CANCELLED' ? <p className="groupevent__venue">{t('Cancelado')}</p> : null}
        <p className="groupevent__venue">{meetup.event ? <VenueLink venueId={meetup.event.venueId} name={meetup.event.venueName} nested /> : 'Local do evento'}</p>
        <dl className="groupevent__facts">
          <div>
            <dt>{t('Confirmados')}</dt>
            <dd>{meetup.confirmedCount}</dd>
          </div>
          <div>
            <dt>{t('Data')}</dt>
            <dd>{dateFmt.format(start)}</dd>
          </div>
          <div>
            <dt>{t('Hora')}</dt>
            <dd>{timeFmt.format(start)}</dd>
          </div>
        </dl>
      </div>
    </>
  );
  return (
    <li className={`groupevent${meetup.status === 'CANCELLED' ? ' groupevent--cancelled' : ''}`}>
      {meetup.event ? (
        <Link to={`/eventos/${encodeURIComponent(meetup.event.id)}`} className="groupevent__link">
          {body}
        </Link>
      ) : (
        body
      )}
      {onManage ? (
        <div className="groupmanage groupmanage--event">
          <Button small variant="secondary" onClick={onManage}>
            {t('Editar encontro')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}


/** Encontros marcados nesta conversa. */
export function SharedEvents({ meetups }: { meetups: MeetupView[] }) {
  if (meetups.length === 0) return <EmptyState title={t('Nenhum evento ainda')}>{t('Os encontros marcados nesta conversa aparecem aqui.')}</EmptyState>;
  return (
    <ul className="groupevents">
      {meetups.map((m) => (
        <GroupEvent key={m.id} meetup={m} />
      ))}
    </ul>
  );
}

/** Mídia da conversa: fotos e vídeos em grade e as mensagens de voz em lista. */
export function SharedMedia({ voice, media, conversationId }: { voice: SharedVoice[]; media: SharedMediaItem[]; conversationId: string }) {
  if (voice.length === 0 && media.length === 0) return <EmptyState title={t('Nenhuma mídia ainda')}>{t('As fotos, os vídeos e as mensagens de voz enviados aqui aparecem nesta aba.')}</EmptyState>;
  return (
    <>
      {media.length > 0 ? (
        <section aria-label={t('Fotos e vídeos')}>
          <ul className="mediagrid">
            {media.map((m) => (
              <li key={m.messageId}>
                <MediaThumb conversationId={conversationId} messageId={m.messageId} kind={m.kind} label={`${m.kind === 'VIDEO' ? 'Vídeo' : t('Foto')} de ${m.mine ? 'você' : m.senderName}, ${dateFmt.format(new Date(m.createdAt))}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {voice.length > 0 ? (
        <ul className="sharedlist">
          {voice.map((v) => (
            <li key={v.messageId} className="sharedlist__item">
              <p className="sharedlist__meta">
                {v.mine ? t('Você') : v.senderName} · {dateFmt.format(new Date(v.createdAt))} {timeFmt.format(new Date(v.createdAt))}
              </p>
              <div className={`bubble bubble--voice${v.mine ? ' bubble--mine' : ''}`}>
                <VoiceBubble message={{ id: v.messageId, audio: { durationMs: v.durationMs } } as unknown as ChatMessage} conversationId={conversationId} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Links que apareceram nas mensagens, do mais recente para o mais antigo. */
export function SharedLinks({ links }: { links: SharedLink[] }) {
  if (links.length === 0) return <EmptyState title={t('Nenhum link ainda')}>{t('Os links enviados nas mensagens aparecem aqui.')}</EmptyState>;
  return (
    <ul className="sharedlist">
      {links.map((l) => (
        <li key={`${l.messageId}|${l.url}`} className="sharedlist__item">
          <p className="sharedlist__meta">
            {l.mine ? t('Você') : l.senderName} · {dateFmt.format(new Date(l.createdAt))}
          </p>
          <a className="sharedlist__link" href={l.url} target="_blank" rel="noopener noreferrer">
            {l.url}
          </a>
        </li>
      ))}
    </ul>
  );
}
