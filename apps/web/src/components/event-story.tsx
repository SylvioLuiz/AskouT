import { useEffect, useRef, useState } from 'react';
import { SoundToggle } from './sound-toggle.tsx';
import { ChevronRightIcon, EventKindIcon, LocationIcon, MoreIcon, TrashIcon, XIcon } from './icons.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar } from './ui.tsx';
import { StoryCaption } from './story-composer.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import { STORY_PHOTO_MS, nextStory, prevStory } from '../lib/stories.ts';
import type { StoryPos } from '../lib/stories.ts';
import type { EventStoryGroup, StoryEvent } from '../lib/types.ts';
import { formatWhen } from '../lib/chat.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Reações rápidas no pé do story. */
const STORY_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'] as const;

// ---------- Publicar ----------

/** Criar story: tela cheia no estilo do Instagram (ver story-composer.tsx). */
export { StoryComposer as StoryCreateSheet } from './story-composer.tsx';

// ---------- Assistir ----------

/** Sem `eventId`, são os stories da página inicial: cada um mostra de qual evento veio. */
export function StoryViewer({ eventId, groups, start, onClose, onChanged }: { eventId?: string; groups: EventStoryGroup[]; start: StoryPos; onClose: () => void; onChanged: () => void }) {
  const [pos, setPos] = useState<StoryPos>(start);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reporting, setReporting] = useState(false);
  /** Reação enviada no story atual (some sozinha depois de um instante). */
  const [sentReaction, setSentReaction] = useState<{ storyId: string; emoji: string } | undefined>();
  const [reacting, setReacting] = useState(false);
  /** Id do story cuja mídia já carregou inteira: só então aparece e o tempo começa a contar. */
  const [readyId, setReadyId] = useState<string | undefined>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const spentRef = useRef(0);
  const group = groups[pos.group];
  const item = group?.items[pos.item];

  function advance() {
    const next = nextStory(groups, pos);
    if (next) setPos(next);
    else onClose();
  }
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // O relógio recomeça a cada story.
  useEffect(() => {
    spentRef.current = 0;
    setError(undefined);
  }, [item?.id]);

  // Foto: baixa e decodifica fora da tela; só mostra quando está inteira (nada de meia imagem aparecendo).
  // Já deixa a próxima foto baixando, para a troca ser instantânea.
  const ready = !!item && readyId === item.id;
  useEffect(() => {
    if (!item || item.kind !== 'IMAGE') return;
    let cancelled = false;
    const id = item.id;
    const img = new Image();
    img.src = api.storyMediaUrl(id);
    img
      .decode()
      .then(() => {
        if (!cancelled) setReadyId(id);
      })
      .catch(() => {
        if (!cancelled) setError(t('Não foi possível abrir esta foto.'));
      });
    const next = nextStory(groups, pos);
    const upcoming = next ? groups[next.group]?.items[next.item] : undefined;
    if (upcoming?.kind === 'IMAGE') new Image().src = api.storyMediaUrl(upcoming.id);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Barra de progresso a cada quadro, direto no elemento (sem re-render): anda lisa, sem pulos.
  // Foto passa sozinha e pausa enquanto a denúncia está aberta; vídeo segue o tempo do próprio vídeo.
  useEffect(() => {
    if (!item || reporting) return;
    if (!ready) {
      if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
      return;
    }
    let frame = 0;
    let last = performance.now();
    const paint = (ratio: number) => {
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`;
    };
    const tick = (now: number) => {
      if (item.kind === 'IMAGE') {
        // Limita o salto para a aba escondida não pular o story inteiro ao voltar.
        spentRef.current += Math.min(now - last, 100);
        last = now;
        const ratio = Math.min(1, spentRef.current / STORY_PHOTO_MS);
        paint(ratio);
        if (ratio >= 1) {
          advanceRef.current();
          return;
        }
      } else {
        const video = videoRef.current;
        paint(video && video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [item?.id, reporting, ready]);

  useEffect(() => {
    if (reporting) videoRef.current?.pause();
    else void videoRef.current?.play().catch(() => undefined);
  }, [reporting]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') advanceRef.current();
      if (event.key === 'ArrowLeft') setPos((p) => prevStory(groups, p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, onClose]);

  if (!group || !item) return null;

  async function remove() {
    if (!item) return;
    setBusy(true);
    setError(undefined);
    try {
      if (eventId) await api.deleteEventStory(eventId, item.id);
      else await api.deleteProfileStory(item.id);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(false);
    }
  }

  async function react(emoji: string) {
    if (!item || reacting) return;
    const storyId = item.id;
    setReacting(true);
    setError(undefined);
    try {
      if (eventId) await api.reactEventStory(eventId, storyId, emoji);
      else await api.reactProfileStory(storyId, emoji);
      setSentReaction({ storyId, emoji });
      window.setTimeout(() => setSentReaction((s) => (s?.storyId === storyId ? undefined : s)), 1800);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setReacting(false);
    }
  }

  const src = api.storyMediaUrl(item.id);
  return (
    <div className={`storyview${!eventId && item.event ? ' storyview--placed' : ''}`} role="dialog" aria-modal="true" aria-label={t('Story de {username}', { username: group.author.username })}>
      <div className="storyview__bars" aria-hidden="true">
        {group.items.map((it, index) => (
          <span key={it.id} className="storyview__bar">
            <span ref={index === pos.item ? fillRef : undefined} className="storyview__fill" style={{ transform: index < pos.item ? 'scaleX(1)' : 'scaleX(0)' }} />
          </span>
        ))}
      </div>
      <header className="storyview__head">
        <Link to={`/u/${encodeURIComponent(group.author.username)}`} className="storyview__who">
          <Avatar profile={group.author} size={36} />
          <span className="storyview__whotext">
            <span className="storyview__whoname">
              <strong>{group.author.username}</strong>
              <span>{timeAgo(item.createdAt, new Date())}</span>
            </span>
            {!eventId && item.event?.place ? (
              <span className="storyview__whoplace">
                <LocationIcon />
                <span>{item.event.place}</span>
              </span>
            ) : null}
          </span>
        </Link>
        {!group.mine ? (
          <button type="button" className="storyview__btn storyview__btn--quiet" onClick={() => setReporting(true)} aria-label={t('Mais opções do story')} aria-haspopup="dialog">
            <MoreIcon />
          </button>
        ) : null}
        {item.canDelete ? (
          <button type="button" className="storyview__btn" onClick={() => void remove()} disabled={busy} aria-label={t('Apagar este story')}>
            <TrashIcon />
          </button>
        ) : null}
        <button type="button" className="storyview__btn" onClick={onClose} aria-label={t('Fechar')}>
          <XIcon />
        </button>
      </header>
      <div className="storyview__stage">
        {item.kind === 'VIDEO' ? (
          <video
            key={item.id}
            ref={videoRef}
            className="storyview__media"
            src={src}
            autoPlay
            playsInline
            muted={muted}
            style={ready ? undefined : { opacity: 0 }}
            onCanPlay={() => setReadyId(item.id)}
            onEnded={advance}
            onError={() => setError(t('Não foi possível abrir este vídeo.'))}
          />
        ) : (
          ready ? <img key={item.id} className="storyview__media" src={src} alt="" onError={() => setError(t('Não foi possível abrir esta foto.'))} /> : null
        )}
        {ready && item.caption ? <StoryCaption text={item.caption} y={item.captionY} /> : null}
        {!ready && !error ? <span className="storyview__loading" role="status" aria-label={t('Carregando story')} /> : null}
        <button type="button" className="storyview__tap storyview__tap--prev" onClick={() => setPos(prevStory(groups, pos))} aria-label={t('Story anterior')} />
        <button type="button" className="storyview__tap storyview__tap--next" onClick={advance} aria-label={t('Próximo story')} />
        {item.kind === 'VIDEO' ? <SoundToggle muted={muted} onToggle={() => setMuted((m) => !m)} /> : null}
      </div>
      {!group.mine ? (
        <div className="storyreact" role="group" aria-label={t('Reagir ao story')}>
          {STORY_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="storyreact__btn" disabled={reacting} onClick={() => void react(emoji)} aria-label={t('Reagir com {emoji}', { emoji })}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      {sentReaction?.storyId === item.id ? (
        <div className="storyreact__sent" role="status">
          <span className="storyreact__burst" aria-hidden="true">{sentReaction.emoji}</span>
          <span>{t('Reação enviada para {username}', { username: group.author.username })}</span>
        </div>
      ) : null}
      {!eventId && item.event ? <StoryPlace event={item.event} username={group.author.username} /> : null}
      {error ? <p className="storyview__error">{error}</p> : null}
      {reporting ? (
        <ReasonSheet
          title={t('Denunciar story')}
          doneText={t('Denúncia enviada. Você não verá mais este story.')}
          submit={(reason, details) => (eventId ? api.reportEventStory(eventId, item.id, reason, details) : api.reportProfileStory(item.id, reason, details))}
          onClose={() => setReporting(false)}
          onDone={() => {
            setReporting(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------- Onde a pessoa está ----------

/** Situação do evento agora: acontecendo, ainda vai começar ou já acabou. */
function eventPhase(event: Pick<StoryEvent, 'startsAt' | 'endsAt'>, now: Date): 'LIVE' | 'SOON' | 'ENDED' {
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (end <= now.getTime()) return 'ENDED';
  return start <= now.getTime() ? 'LIVE' : 'SOON';
}

/** Quem confirmou, contando você quando você também vai. */
function goingText(event: Pick<StoryEvent, 'confirmedCount' | 'going'>): string {
  const n = event.confirmedCount;
  if (event.going) return n <= 1 ? t('Você vai') : n === 2 ? t('Você e mais 1 pessoa vão') : t('Você e mais {n} pessoas vão', { n: n - 1 });
  return n === 1 ? t('1 pessoa vai') : t('{n} pessoas vão', { n });
}

/**
 * Cartão discreto no pé do story: o evento e o local onde a pessoa está, com capa, horário e quem vai.
 * Tocar abre o evento.
 */
export function StoryPlace({ event, username }: { event: StoryEvent; username: string }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const now = new Date();
  const phase = eventPhase(event, now);
  const cover = coverFailed ? null : safeImage(event.coverPath);
  const where = [event.place, event.address].filter((part): part is string => !!part && part.trim() !== '');
  return (
    <Link
      to={`/eventos/${encodeURIComponent(event.id)}`}
      className="storyplace"
      aria-label={t('{username} está em {title}. Abrir o evento', { username, title: event.title })}
    >
      <span className={`storyplace__thumb${cover ? '' : ` evcover--${event.kind.toLowerCase()}`}`} aria-hidden="true">
        {cover ? <img src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : <EventKindIcon kind={event.kind} />}
      </span>
      <span className="storyplace__body">
        <span className={`storyplace__when storyplace__when--${phase.toLowerCase()}`}>
          {phase === 'LIVE' ? <span className="storyplace__live" aria-hidden="true" /> : null}
          <span>{phase === 'ENDED' ? t('Já terminou') : formatWhen(event.startsAt, event.endsAt, now)}</span>
        </span>
        <strong className="storyplace__title">{event.title}</strong>
        {where.length > 0 ? <span className="storyplace__where">{where.join(' · ')}</span> : null}
        <span className="storyplace__meta">
          <span>{kindLabel(event.kind)}</span>
          {event.isFree ? <span>{t('Grátis')}</span> : null}
          {event.confirmedCount > 0 ? <span>{goingText(event)}</span> : null}
        </span>
      </span>
      <span className="storyplace__go" aria-hidden="true">
        <ChevronRightIcon />
      </span>
    </Link>
  );
}
