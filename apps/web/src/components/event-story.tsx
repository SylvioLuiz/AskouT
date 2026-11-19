import { useEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { SoundToggle } from './sound-toggle.tsx';
import { StoryOverlayLayer, useKeyboardInset, useMediaBox } from './story-overlays.tsx';
import { ChevronRightIcon, EventKindIcon, HeartIcon, LocationIcon, MoreIcon, SendIcon, TrashIcon, XIcon } from './icons.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar, Confirm } from './ui.tsx';
import { Sheet } from './agenda.tsx';
import { StoryCaption } from './story-gallery.tsx';
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

/** Reações rápidas: aparecem ao tocar em "Enviar mensagem", como no Instagram. */
const STORY_REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'] as const;
/** Tamanho máximo da resposta (o servidor confere de novo). */
const STORY_REPLY_MAX = 500;

// ---------- Assistir ----------

/** Sem `eventId`, são os stories da página inicial: cada um mostra de qual evento veio. */
export function StoryViewer({ eventId, groups, start, onClose, onChanged }: { eventId?: string; groups: EventStoryGroup[]; start: StoryPos; onClose: () => void; onChanged: () => void }) {
  const [pos, setPos] = useState<StoryPos>(start);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reporting, setReporting] = useState(false);
  /** Reação ou resposta enviada no story atual (some sozinha depois de um instante). */
  const [sentReaction, setSentReaction] = useState<{ storyId: string; emoji?: string } | undefined>();
  const [reacting, setReacting] = useState(false);
  /** Escrevendo uma resposta: o story pausa e as reações rápidas aparecem. */
  const [composing, setComposing] = useState(false);
  const [reply, setReply] = useState('');
  /** Curtidas mudadas aqui (por cima do que veio da lista). */
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [likePop, setLikePop] = useState<string | undefined>();
  const replyRef = useRef<HTMLInputElement>(null);
  const keyboard = useKeyboardInset();
  /** Pedindo confirmação para apagar o story (pausa enquanto isso). */
  const [askDelete, setAskDelete] = useState(false);
  /** Puxando o story para baixo para fechar (como no Instagram): pausa enquanto o dedo está na tela. */
  const [pulling, setPulling] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<{ id: number; x0: number; y0: number; dy: number; active: boolean } | undefined>(undefined);
  const swallowClick = useRef(false);
  const paused = reporting || composing || askDelete || pulling;
  /** Id do story cuja mídia já carregou inteira: só então aparece e o tempo começa a contar. */
  const [readyId, setReadyId] = useState<string | undefined>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Tamanho real da mídia do story atual: os textos por cima são encaixados nela. */
  const [natural, setNatural] = useState<{ id: string; width: number; height: number } | undefined>();
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
    setReply('');
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
        if (cancelled) return;
        setNatural({ id, width: img.naturalWidth, height: img.naturalHeight });
        setReadyId(id);
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
    if (!item || paused) return;
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
  }, [item?.id, paused, ready]);

  useEffect(() => {
    if (paused) videoRef.current?.pause();
    else void videoRef.current?.play().catch(() => undefined);
  }, [paused]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escrevendo a resposta, as setas mexem no texto e o Esc só sai do campo.
      if (document.activeElement === replyRef.current) {
        if (event.key === 'Escape') replyRef.current?.blur();
        return;
      }
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') advanceRef.current();
      if (event.key === 'ArrowLeft') setPos((p) => prevStory(groups, p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, onClose]);

  const mediaBox = useMediaBox(stageRef, item && natural?.id === item.id ? natural : undefined);

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

  function showSent(storyId: string, emoji?: string) {
    setSentReaction({ storyId, emoji });
    window.setTimeout(() => setSentReaction((s) => (s?.storyId === storyId ? undefined : s)), 1800);
  }

  async function react(emoji: string) {
    if (!item || reacting) return;
    const storyId = item.id;
    setReacting(true);
    setError(undefined);
    replyRef.current?.blur();
    try {
      if (eventId) await api.reactEventStory(eventId, storyId, emoji);
      else await api.reactProfileStory(storyId, emoji);
      showSent(storyId, emoji);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setReacting(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    const text = reply.trim();
    if (!item || reacting || text === '') return;
    const storyId = item.id;
    setReacting(true);
    setError(undefined);
    try {
      await api.replyStory(storyId, text, eventId);
      setReply('');
      replyRef.current?.blur();
      showSent(storyId);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setReacting(false);
    }
  }

  /** Coração: muda na hora e desfaz se o servidor recusar. */
  async function toggleLike() {
    if (!item) return;
    const storyId = item.id;
    const next = !(likes[storyId] ?? item.liked ?? false);
    setLikes((l) => ({ ...l, [storyId]: next }));
    if (next) {
      setLikePop(storyId);
      window.setTimeout(() => setLikePop((s) => (s === storyId ? undefined : s)), 500);
      navigator.vibrate?.(10);
    }
    try {
      await api.likeStory(storyId, next, eventId);
    } catch (failure) {
      setLikes((l) => ({ ...l, [storyId]: !next }));
      setError(toApiError(failure).message);
    }
  }

  // ---- Puxar para baixo fecha. Só conta um gesto claramente vertical; soltar antes do limite volta ao lugar. ----
  function pullStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (composing || askDelete || reporting || pullRef.current) return;
    if ((event.target as Element).closest('input, textarea, .storyreply, .storyview__head, .storyplace, .soundtoggle, .sheet')) return;
    pullRef.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, dy: 0, active: false };
  }

  function pullMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (!pull || pull.id !== event.pointerId) return;
    const dy = event.clientY - pull.y0;
    const dx = event.clientX - pull.x0;
    if (!pull.active) {
      if (dy > 12 && dy > Math.abs(dx) * 1.5) {
        pull.active = true;
        setPulling(true);
      } else if (Math.abs(dx) > 12 || dy < -12) {
        pullRef.current = undefined;
        return;
      } else return;
    }
    pull.dy = Math.max(0, dy);
    const el = rootRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${pull.dy}px) scale(${1 - Math.min(pull.dy / 2000, 0.08)})`;
      el.style.opacity = String(1 - Math.min(pull.dy / 700, 0.4));
    }
  }

  function pullEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (!pull || pull.id !== event.pointerId) return;
    pullRef.current = undefined;
    if (!pull.active) return;
    setPulling(false);
    // O toque que arrastou não vale como "próximo/anterior".
    swallowClick.current = true;
    window.setTimeout(() => (swallowClick.current = false), 0);
    const el = rootRef.current;
    if (pull.dy > 110 && event.type === 'pointerup') {
      onClose();
      return;
    }
    if (el) {
      el.style.transition = 'transform 180ms ease, opacity 180ms ease';
      el.style.transform = '';
      el.style.opacity = '';
    }
  }

  const src = api.storyMediaUrl(item.id);
  const liked = likes[item.id] ?? item.liked ?? false;
  return (
    <div
      ref={rootRef}
      onPointerDown={pullStart}
      onPointerMove={pullMove}
      onPointerUp={pullEnd}
      onPointerCancel={pullEnd}
      onClickCapture={(event) => {
        if (swallowClick.current) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
      className={`storyview${!eventId && item.event ? ' storyview--placed' : ''}${group.mine ? '' : ' storyview--replies'}`} role="dialog" aria-modal="true" aria-label={t('Story de {username}', { username: group.author.username })}>
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
          <button type="button" className="storyview__btn" onClick={() => setAskDelete(true)} disabled={busy} aria-label={t('Apagar este story')}>
            <TrashIcon />
          </button>
        ) : null}
        <button type="button" className="storyview__btn" onClick={onClose} aria-label={t('Fechar')}>
          <XIcon />
        </button>
      </header>
      <div ref={stageRef} className="storyview__stage">
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
            onLoadedMetadata={(event) => setNatural({ id: item.id, width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
            onCanPlay={() => setReadyId(item.id)}
            onEnded={advance}
            onError={() => setError(t('Não foi possível abrir este vídeo.'))}
          />
        ) : (
          ready ? <img key={item.id} className="storyview__media" src={src} alt="" onError={() => setError(t('Não foi possível abrir esta foto.'))} /> : null
        )}
        {ready && item.overlays?.length ? <StoryOverlayLayer overlays={item.overlays} box={mediaBox} /> : null}
        {ready && item.caption ? <StoryCaption text={item.caption} y={item.captionY} /> : null}
        {!ready && !error ? <span className="storyview__loading" role="status" aria-label={t('Carregando story')} /> : null}
        <button type="button" className="storyview__tap storyview__tap--prev" onClick={() => setPos(prevStory(groups, pos))} aria-label={t('Story anterior')} />
        <button type="button" className="storyview__tap storyview__tap--next" onClick={advance} aria-label={t('Próximo story')} />
        {item.kind === 'VIDEO' ? <SoundToggle muted={muted} onToggle={() => setMuted((m) => !m)} /> : null}
      </div>
      {composing ? <button type="button" className="storyreply__shade" onPointerDown={(event) => event.preventDefault()} onClick={() => replyRef.current?.blur()} aria-label={t('Voltar ao story')} tabIndex={-1} /> : null}
      {!group.mine ? (
        <div className={`storyreply${composing ? ' is-composing' : ''}${item.kind === 'VIDEO' ? ' storyreply--video' : ''}`} style={keyboard > 0 ? { bottom: `${keyboard + 8}px` } : undefined}>
          {composing ? (
            <div className="storyreply__quick" role="group" aria-label={t('Reagir ao story')}>
              {STORY_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="storyreply__emoji"
                  disabled={reacting}
                  onPointerDown={(event) => event.preventDefault() /* não fecha o teclado antes do toque valer */}
                  onClick={() => void react(emoji)}
                  aria-label={t('Reagir com {emoji}', { emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
          <form className="storyreply__bar" onSubmit={(event) => void sendReply(event)}>
            <input
              ref={replyRef}
              className="storyreply__input"
              type="text"
              value={reply}
              maxLength={STORY_REPLY_MAX}
              onChange={(event) => setReply(event.target.value)}
              onFocus={() => setComposing(true)}
              onBlur={() => setComposing(false)}
              placeholder={t('Enviar mensagem')}
              aria-label={t('Responder a {username}', { username: group.author.username })}
              enterKeyHint="send"
              autoComplete="off"
            />
            {reply.trim() ? (
              <button type="submit" className="storyreply__send" disabled={reacting} onPointerDown={(event) => event.preventDefault()} aria-label={t('Enviar')}>
                <SendIcon />
              </button>
            ) : (
              <button type="button" className={`storyreply__heart${liked ? ' is-on' : ''}${likePop === item.id ? ' is-pop' : ''}`} onClick={() => void toggleLike()} aria-pressed={liked} aria-label={liked ? t('Descurtir o story') : t('Curtir o story')}>
                <HeartIcon filled={liked} />
              </button>
            )}
          </form>
        </div>
      ) : null}
      {sentReaction?.storyId === item.id ? (
        <div className="storyreact__sent" role="status">
          {sentReaction.emoji ? <span className="storyreact__burst" aria-hidden="true">{sentReaction.emoji}</span> : null}
          <span>{sentReaction.emoji ? t('Reação enviada para {username}', { username: group.author.username }) : t('Mensagem enviada para {username}', { username: group.author.username })}</span>
        </div>
      ) : null}
      {!eventId && item.event ? <StoryPlace event={item.event} username={group.author.username} /> : null}
      {error ? <p className="storyview__error">{error}</p> : null}
      {askDelete ? (
        <Sheet title={t('Apagar story')} onClose={() => setAskDelete(false)}>
          <Confirm danger question={t('Apagar este story? Ele sai do ar na hora e não dá para desfazer.')} confirmLabel={t('Apagar')} busy={busy} onConfirm={() => void remove()} onCancel={() => setAskDelete(false)} />
        </Sheet>
      ) : null}
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
