import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from './agenda.tsx';
import { SoundToggle } from './sound-toggle.tsx';
import { MoreIcon, TrashIcon, XIcon } from './icons.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar, Button, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import { mediaKind, prepareImage } from '../lib/chat-media.ts';
import { isVideoFile, videoPoster, videoProblem } from '../lib/post-video.ts';
import { STORY_PHOTO_MS, nextStory, prevStory } from '../lib/stories.ts';
import type { StoryPos } from '../lib/stories.ts';
import type { EventStoryGroup } from '../lib/types.ts';
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

  async function publish() {
    if (!file) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await api.createEventStory(eventId, file.blob);
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
      <div className="storysheet__actions">
        <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          {file ? t('Trocar') : t('Escolher foto ou vídeo')}
        </Button>
        {file ? (
          <Button loading={busy} onClick={() => void publish()}>
            {t('Publicar story')}
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}

// ---------- Assistir ----------

export function StoryViewer({ eventId, groups, start, onClose, onChanged }: { eventId: string; groups: EventStoryGroup[]; start: StoryPos; onClose: () => void; onChanged: () => void }) {
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
      await api.deleteEventStory(eventId, item.id);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(false);
    }
  }

  const src = api.storyMediaUrl(item.id);
  return (
    <div className="storyview" role="dialog" aria-modal="true" aria-label={t('Story de {username}', { username: group.author.username })}>
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
          <strong>{group.author.username}</strong>
          <span>{timeAgo(item.createdAt, new Date())}</span>
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
      {error ? <p className="storyview__error">{error}</p> : null}
      {reporting ? (
        <ReasonSheet
          title={t('Denunciar story')}
          doneText={t('Denúncia enviada. Você não verá mais este story.')}
          submit={(reason, details) => api.reportEventStory(eventId, item.id, reason, details)}
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
