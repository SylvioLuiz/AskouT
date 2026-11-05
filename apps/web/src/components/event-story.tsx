import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from './agenda.tsx';
import { SoundToggle } from './sound-toggle.tsx';
import { ChevronRightIcon, EventKindIcon, LocationIcon, MoreIcon, TrashIcon, XIcon } from './icons.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar, Button, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import { mediaKind, prepareImage } from '../lib/chat-media.ts';
import { isVideoFile, videoPoster, videoProblem } from '../lib/post-video.ts';
import { STORY_PHOTO_MS, nextStory, prevStory } from '../lib/stories.ts';
import type { StoryPos } from '../lib/stories.ts';
import type { EventStoryGroup, StoryEvent } from '../lib/types.ts';
import { formatWhen } from '../lib/chat.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

// ---------- Publicar ----------

export function StoryCreateSheet({ eventId, onClose, onCreated }: { eventId: string; onClose: () => void; onCreated: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ blob: Blob; kind: 'IMAGE' | 'VIDEO'; url: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  useEffect(() => () => file && URL.revokeObjectURL(file.url), [file]);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setProblem(undefined);
    setBusy(true);
    try {
      const kind = mediaKind(picked);
      if (kind === 'VIDEO' || isVideoFile(picked)) {
        const bad = videoProblem(picked);
        if (bad) throw new Error(bad);
        await videoPoster(picked); // confere a duração (até 3 minutos)
        setFile({ blob: picked, kind: 'VIDEO', url: URL.createObjectURL(picked) });
      } else if (kind === 'IMAGE') {
        const blob = await prepareImage(picked);
        setFile({ blob, kind: 'IMAGE', url: URL.createObjectURL(blob) });
      } else {
        throw new Error(t('Escolha uma foto ou um vídeo.'));
      }
    } catch (failure) {
      setProblem(failure instanceof Error && failure.message !== 'grande' && failure.message !== 'canvas' ? failure.message : t('Não foi possível usar este arquivo. Tente outro.'));
    } finally {
      setBusy(false);
    }
  }

  async function publish(onProfile: boolean) {
    if (!file) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await api.createEventStory(eventId, file.blob, onProfile);
      onCreated();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Seu story')} onClose={onClose}>
      <p className="muted">{t('Foto ou vídeo. Qualquer pessoa vê, fica no ar por 24 h e some quando o evento acabar.')}</p>
      <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="visually-hidden" onChange={(event) => void pick(event)} aria-label={t('Escolher foto ou vídeo')} />
      {file ? (
        <div className="storysheet__preview">{file.kind === 'VIDEO' ? <video src={file.url} controls playsInline muted /> : <img src={file.url} alt={t('Prévia do story')} />}</div>
      ) : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {file ? (
        <div className="storysheet__ask" role="group" aria-labelledby="storysheet-ask">
          <p id="storysheet-ask" className="storysheet__question">
            <strong>{t('Publicar também no seu perfil?')}</strong>
            <span className="muted">{t('Seus amigos veem na página inicial, junto com o evento onde você está. Se não, ele fica só neste evento.')}</span>
          </p>
        </div>
      ) : null}
      <div className="storysheet__actions">
        {file ? (
          <>
            <Button loading={busy} onClick={() => void publish(true)}>
              {t('Sim, no evento e no perfil')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void publish(false)}>
              {t('Não, só no evento')}
            </Button>
          </>
        ) : null}
        <Button variant={file ? 'quiet' : 'secondary'} disabled={busy} onClick={() => fileRef.current?.click()}>
          {file ? t('Trocar foto ou vídeo') : t('Escolher foto ou vídeo')}
        </Button>
      </div>
    </Sheet>
  );
}

// ---------- Assistir ----------

/** Sem `eventId`, são os stories da página inicial: cada um mostra de qual evento veio. */
export function StoryViewer({ eventId, groups, start, onClose, onChanged }: { eventId?: string; groups: EventStoryGroup[]; start: StoryPos; onClose: () => void; onChanged: () => void }) {
  const [pos, setPos] = useState<StoryPos>(start);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);
  const [reporting, setReporting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const group = groups[pos.group];
  const item = group?.items[pos.item];

  function advance() {
    const next = nextStory(groups, pos);
    if (next) setPos(next);
    else onClose();
  }
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // Foto: passa sozinha; o relógio recomeça a cada story.
  useEffect(() => {
    setProgress(0);
    setError(undefined);
    if (!item || item.kind !== 'IMAGE' || reporting) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const spent = Date.now() - startedAt;
      setProgress(Math.min(1, spent / STORY_PHOTO_MS));
      if (spent >= STORY_PHOTO_MS) advanceRef.current();
    }, 100);
    return () => window.clearInterval(timer);
  }, [item?.id, reporting]);

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

  const src = api.storyMediaUrl(item.id);
  return (
    <div className={`storyview${!eventId && item.event ? ' storyview--placed' : ''}`} role="dialog" aria-modal="true" aria-label={t('Story de {username}', { username: group.author.username })}>
      <div className="storyview__bars" aria-hidden="true">
        {group.items.map((it, index) => (
          <span key={it.id} className="storyview__bar">
            <span className="storyview__fill" style={{ width: index < pos.item ? '100%' : index === pos.item ? `${Math.round((item.kind === 'IMAGE' ? progress : 0) * 100)}%` : '0%' }} />
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
            onTimeUpdate={(event) => setProgress(event.currentTarget.duration > 0 ? event.currentTarget.currentTime / event.currentTarget.duration : 0)}
            onEnded={advance}
            onError={() => setError(t('Não foi possível abrir este vídeo.'))}
          />
        ) : (
          <img key={item.id} className="storyview__media" src={src} alt="" onError={() => setError(t('Não foi possível abrir esta foto.'))} />
        )}
        <button type="button" className="storyview__tap storyview__tap--prev" onClick={() => setPos(prevStory(groups, pos))} aria-label={t('Story anterior')} />
        <button type="button" className="storyview__tap storyview__tap--next" onClick={advance} aria-label={t('Próximo story')} />
        {item.kind === 'VIDEO' ? <SoundToggle muted={muted} onToggle={() => setMuted((m) => !m)} /> : null}
      </div>
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
