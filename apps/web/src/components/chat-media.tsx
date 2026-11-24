import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { DOUBLE_TAP_MS, LONG_PRESS_MS } from '../lib/chat.ts';
import { api } from '../client.ts';
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XIcon } from './icons.tsx';
import { useCloseOnBack } from './photo-viewer.tsx';
import { edgeResist, stepIndex, swipeAxis, swipeStep } from '../lib/media-gallery.ts';
import type { ChatMessage } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

// Cache de fotos/vídeos já baixados (o token vai no cabeçalho, então não dá para usar <img src> direto).
const cache = new Map<string, string>();
const CACHE_MAX = 60;

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      URL.revokeObjectURL(cache.get(oldest) as string);
      cache.delete(oldest);
    }
  }
}

/** Baixa o arquivo da mensagem (uma vez) e devolve um endereço local para mostrar. `enabled` adia o download (vídeo só ao tocar). */
export function useMessageMedia(conversationId: string, messageId: string, enabled = true): { url: string | undefined; failed: boolean } {
  const key = `${conversationId}/${messageId}`;
  const [url, setUrl] = useState<string | undefined>(() => cache.get(key));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || cache.has(key)) {
      setUrl(cache.get(key));
      return;
    }
    let alive = true;
    api
      .messageMedia(conversationId, messageId)
      .then((blob) => {
        const made = URL.createObjectURL(blob);
        remember(key, made);
        if (alive) setUrl(made);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [conversationId, messageId, enabled, key]);
  return { url, failed };
}

/** Zoom máximo da foto em tela cheia e o do toque duplo. */
const ZOOM_MAX = 4;
const ZOOM_TAP = 2.5;
/** Arrastar a foto para baixo além disso fecha. */
const CLOSE_DRAG = 120;

/** Uma foto ou vídeo da conversa, para andar entre eles no visualizador. */
export interface GalleryItem {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  label: string;
}

/** Descrição da foto ou vídeo para leitores de tela ("Foto enviada por Bia"). */
export function mediaLabel(message: Pick<ChatMessage, 'kind' | 'senderName' | 'mine'>): string {
  return `${message.kind === 'VIDEO' ? t('Vídeo enviado') : t('Foto enviada')} por ${message.mine ? 'você' : (message.senderName ?? 'alguém')}`;
}

/** Fotos e vídeos de uma lista de mensagens, na ordem da conversa (as apagadas ficam de fora). */
export function galleryOf(messages: readonly ChatMessage[]): GalleryItem[] {
  return messages.filter((m) => (m.kind === 'IMAGE' || m.kind === 'VIDEO') && !m.deleted).map((m) => ({ id: m.id, kind: m.kind as 'IMAGE' | 'VIDEO', label: mediaLabel(m) }));
}

/**
 * Foto ou vídeo em tela cheia, por cima de tudo (vai direto para o <body>, para nenhum balão "prender" a tela).
 * Foto: pinça para dar zoom, arrastar para andar com zoom, toque duplo alterna o zoom e arrastar para baixo fecha.
 * Com `onPrev`/`onNext`: arrastar para o lado e as setas ← → do teclado trocam de foto.
 * Esc, o X, o "voltar" do aparelho ou tocar fora da foto também fecham.
 */
export function MediaViewer({
  kind,
  url,
  label,
  onClose,
  onPrev,
  onNext,
  position,
  failed,
}: {
  kind: 'IMAGE' | 'VIDEO';
  url: string | undefined;
  label: string;
  onClose: () => void;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  position?: { index: number; total: number } | undefined;
  failed?: boolean;
}) {
  const mediaRef = useRef<HTMLImageElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0, drop: 0, swipe: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | undefined>(undefined);
  const lastTap = useRef<{ at: number; x: number; y: number } | undefined>(undefined);
  const moved = useRef(false);
  /** Arrasto de um dedo: de onde saiu e se virou troca de foto (x) ou fechar (y). */
  const drag = useRef<{ x: number; y: number; axis: 'x' | 'y' | undefined } | undefined>(undefined);
  /** Lado de onde a próxima foto entra, depois de trocar. */
  const enter = useRef<-1 | 0 | 1>(0);
  const leaving = useRef(false);
  const nav = useRef({ onPrev, onNext, onClose });
  nav.current = { onPrev, onNext, onClose };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') nav.current.onClose();
      else if (e.key === 'ArrowRight' && nav.current.onNext) {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' && nav.current.onPrev) {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // O "voltar" do aparelho fecha a foto/vídeo em vez de sair da conversa (também trava a rolagem do fundo).
  useCloseOnBack(onClose);

  // Foto nova: começa sem zoom e entra deslizando do lado certo.
  useLayoutEffect(() => {
    const v = view.current;
    const from = enter.current;
    enter.current = 0;
    leaving.current = false;
    Object.assign(v, { scale: 1, x: 0, y: 0, drop: 0, swipe: from * (rootRef.current?.clientWidth ?? 0) * 0.35 });
    paint(false);
    if (from !== 0) {
      const frame = window.requestAnimationFrame(() => {
        v.swipe = 0;
        paint(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [url]);

  /** Troca de foto: a atual sai deslizando e a outra entra do lado oposto. */
  function go(step: -1 | 1) {
    const target = step === 1 ? nav.current.onNext : nav.current.onPrev;
    if (!target || leaving.current) return;
    leaving.current = true;
    const width = rootRef.current?.clientWidth ?? 0;
    view.current.swipe = -step * width;
    view.current.scale = 1;
    view.current.x = 0;
    view.current.y = 0;
    paint(true, 160);
    window.setTimeout(() => {
      enter.current = step;
      target();
    }, 140);
  }

  function paint(animate: boolean, ms = 220) {
    const v = view.current;
    const img = mediaRef.current ?? (rootRef.current?.querySelector('.mediaviewer__media') as HTMLElement | null);
    if (img) {
      img.style.transition = animate ? `transform ${ms}ms ease` : 'none';
      img.style.transform = `translate(${v.x + v.swipe}px, ${v.y + v.drop}px) scale(${v.scale})`;
    }
    if (rootRef.current) rootRef.current.style.setProperty('--fade', String(Math.max(0.3, 1 - Math.abs(v.drop) / 400)));
  }

  /** Não deixa a foto com zoom sair da tela. */
  function clamp() {
    const v = view.current;
    const img = mediaRef.current;
    if (!img) return;
    if (v.scale <= 1) {
      v.scale = 1;
      v.x = 0;
      v.y = 0;
      return;
    }
    const maxX = (img.offsetWidth * (v.scale - 1)) / 2;
    const maxY = (img.offsetHeight * (v.scale - 1)) / 2;
    v.x = Math.min(maxX, Math.max(-maxX, v.x));
    v.y = Math.min(maxY, Math.max(-maxY, v.y));
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (kind !== 'IMAGE' || leaving.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    drag.current = pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, axis: undefined } : undefined;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
      view.current.swipe = 0;
    }
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    const v = view.current;
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      v.scale = Math.min(ZOOM_MAX, Math.max(0.8, (pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist));
      moved.current = true;
    } else {
      const dx = now.x - prev.x;
      const dy = now.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved.current = true;
      if (v.scale > 1) {
        v.x += dx;
        v.y += dy;
      } else {
        const d = drag.current;
        if (d && !d.axis) d.axis = swipeAxis(now.x - d.x, now.y - d.y);
        if (d?.axis === 'x') {
          const total = now.x - d.x;
          v.swipe = edgeResist(total, total < 0 ? !!nav.current.onNext : !!nav.current.onPrev);
        } else if (d?.axis === 'y') {
          v.drop += dy;
        }
      }
    }
    paint(false);
  }

  function up(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
    if (pointers.current.size > 0) return;
    const v = view.current;
    const d = drag.current;
    drag.current = undefined;
    if (Math.abs(v.drop) > CLOSE_DRAG) return onClose();
    v.drop = 0;
    if (d?.axis === 'x' && v.scale <= 1) {
      const step = swipeStep(v.swipe, rootRef.current?.clientWidth ?? window.innerWidth);
      if (step !== 0 && (step === 1 ? nav.current.onNext : nav.current.onPrev)) return go(step);
      v.swipe = 0;
      paint(true);
      return;
    }
    v.swipe = 0;
    if (!moved.current) {
      // Toque duplo alterna o zoom (no ponto tocado); toque simples fora da foto fecha.
      const at = Date.now();
      const tap = { at, x: e.clientX, y: e.clientY };
      const prev = lastTap.current;
      if (prev && at - prev.at < 300 && Math.hypot(tap.x - prev.x, tap.y - prev.y) < 30) {
        lastTap.current = undefined;
        if (v.scale > 1) {
          v.scale = 1;
        } else {
          const rect = mediaRef.current?.getBoundingClientRect();
          v.scale = ZOOM_TAP;
          if (rect) {
            v.x = (rect.left + rect.width / 2 - tap.x) * (ZOOM_TAP - 1);
            v.y = (rect.top + rect.height / 2 - tap.y) * (ZOOM_TAP - 1);
          }
        }
      } else {
        lastTap.current = tap;
        if (e.target === e.currentTarget && v.scale <= 1) {
          window.setTimeout(() => {
            if (lastTap.current === tap) onClose();
          }, 300);
        }
      }
    }
    clamp();
    paint(true);
  }

  // Vídeo: os controles precisam do toque, então só um arrasto lateral claro troca de item.
  const videoSwipe = useRef<{ x: number; y: number } | undefined>(undefined);

  return createPortal(
    <div ref={rootRef} className="mediaviewer" role="dialog" aria-modal="true" aria-label={label}>
      {position && position.total > 1 ? (
        <span className="mediaviewer__count" aria-live="polite">
          {position.index + 1} / {position.total}
        </span>
      ) : null}
      <button type="button" className="mediaviewer__close iconbtn" aria-label={t('Fechar')} onClick={onClose}>
        <XIcon />
      </button>
      {!url ? (
        <div className="mediaviewer__stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <p className="mediaviewer__wait">{failed ? (kind === 'VIDEO' ? t('Não consegui carregar o vídeo.') : t('Não consegui carregar a foto.')) : t('Carregando…')}</p>
        </div>
      ) : kind === 'IMAGE' ? (
        <div className="mediaviewer__stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <img ref={mediaRef} className="mediaviewer__media" src={url} alt={label} draggable={false} />
        </div>
      ) : (
        <div
          className="mediaviewer__stage"
          onClick={(e) => e.target === e.currentTarget && onClose()}
          onPointerDown={(e) => {
            videoSwipe.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const start = videoSwipe.current;
            videoSwipe.current = undefined;
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (Math.abs(dx) > Math.abs(dy) * 1.5) {
              const step = swipeStep(dx, rootRef.current?.clientWidth ?? window.innerWidth);
              if (step !== 0) go(step);
            }
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video key={url} className="mediaviewer__media" src={url} controls autoPlay playsInline />
        </div>
      )}
      {position && position.total > 1 ? (
        <>
          <button type="button" className="mediaviewer__nav mediaviewer__nav--prev" onClick={() => go(-1)} disabled={!onPrev} aria-label={t('Foto anterior')}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="mediaviewer__nav mediaviewer__nav--next" onClick={() => go(1)} disabled={!onNext} aria-label={t('Próxima foto')}>
            <ChevronRightIcon />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * Visualizador que anda entre as fotos e vídeos da conversa, começando em `startId`.
 * A lista fica fixa enquanto está aberto (mensagens novas não mudam a posição).
 */
export function MediaGallery({ conversationId, items, startId, onClose }: { conversationId: string; items: GalleryItem[]; startId: string; onClose: () => void }) {
  const [list] = useState(items);
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((x) => x.id === startId)));
  const item = list[index] ?? list[0];
  const media = useMessageMedia(conversationId, item?.id ?? startId);
  // Deixa a foto vizinha pronta, para a troca não esperar o download.
  const next = list[index + 1];
  const prev = list[index - 1];
  useMessageMedia(conversationId, next?.id ?? startId, next?.kind === 'IMAGE');
  useMessageMedia(conversationId, prev?.id ?? startId, prev?.kind === 'IMAGE');
  if (!item) return null;
  const before = stepIndex(index, -1, list.length);
  const after = stepIndex(index, 1, list.length);
  return (
    <MediaViewer
      kind={item.kind}
      url={media.url}
      failed={media.failed}
      label={item.label}
      onClose={onClose}
      position={{ index, total: list.length }}
      onPrev={before === undefined ? undefined : () => setIndex(before)}
      onNext={after === undefined ? undefined : () => setIndex(after)}
    />
  );
}

/** Foto ou vídeo dentro do balão: a foto aparece sozinha; o vídeo baixa quando a pessoa toca. */
export function MediaBubble({ message, conversationId, onTap, gallery }: { message: Pick<ChatMessage, 'id' | 'kind' | 'senderName' | 'mine'>; conversationId: string; onTap?: (x: number, y: number) => boolean; /** Fotos e vídeos da conversa: com mais de um, dá para andar entre eles. */ gallery?: GalleryItem[] }) {
  const isVideo = message.kind === 'VIDEO';
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  // Quando o dedo desceu: segurar (long press) abre só as reações, então o clique que vem ao soltar é ignorado.
  const pressedAt = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(openTimer.current), []);
  const media = useMessageMedia(conversationId, message.id, !isVideo || wanted);
  const label = mediaLabel(message);
  const browse = gallery !== undefined && gallery.length > 1 && gallery.some((x) => x.id === message.id);

  useEffect(() => {
    if (isVideo && wanted && media.url) setOpen(true);
  }, [isVideo, wanted, media.url]);

  if (media.failed) return <p className="bubble__text muted">{isVideo ? t('Não consegui carregar o vídeo.') : t('Não consegui carregar a foto.')}</p>;
  return (
    <>
      <button
        type="button"
        className={`mediabubble${isVideo ? ' mediabubble--video' : ''}`}
        aria-label={isVideo ? t('Assistir vídeo. {label}', { label }) : t('Abrir foto. {label}', { label })}
        aria-busy={(!media.url && (!isVideo || wanted)) || undefined}
        onPointerDown={(e) => {
          pressedAt.current = e.pointerType === 'mouse' ? undefined : Date.now();
        }}
        onContextMenu={() => {
          // Segurar no celular: cancela qualquer abertura pendente; o balão abre o menu de reações.
          window.clearTimeout(openTimer.current);
          pressedAt.current = 0;
        }}
        onClick={(e) => {
          const downAt = pressedAt.current;
          pressedAt.current = undefined;
          if (downAt !== undefined && (downAt === 0 || Date.now() - downAt >= LONG_PRESS_MS)) {
            window.clearTimeout(openTimer.current);
            return;
          }
          const show = () => {
            if (browse) {
              setOpen(true);
            } else if (isVideo) {
              setWanted(true);
              if (media.url) setOpen(true);
            } else if (media.url) {
              setOpen(true);
            }
          };
          if (!onTap) return show();
          // Espera um instante: se vier o segundo toque, é coração (não abre a foto).
          window.clearTimeout(openTimer.current);
          if (onTap(e.clientX, e.clientY)) return;
          openTimer.current = window.setTimeout(show, DOUBLE_TAP_MS);
        }}
      >
        {!isVideo && media.url ? <img src={media.url} alt="" className="mediabubble__img" draggable={false} /> : null}
        {isVideo ? (
          <span className="mediabubble__play">
            <PlayIcon />
            <span>{wanted && !media.url ? 'Carregando…' : t('Vídeo')}</span>
          </span>
        ) : null}
        {!isVideo && !media.url ? <span className="mediabubble__wait">{t('Carregando…')}</span> : null}
      </button>
      {open && browse ? (
        <MediaGallery conversationId={conversationId} items={gallery} startId={message.id} onClose={() => setOpen(false)} />
      ) : open && media.url ? (
        <MediaViewer
          kind={isVideo ? 'VIDEO' : 'IMAGE'}
          url={media.url}
          label={label}
          onClose={() => {
            setOpen(false);
            setWanted(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Miniatura pequena da foto ou vídeo respondido (na barra "Respondendo a…" e na citação dentro do balão). */
export function ReplyThumb({ conversationId, messageId, kind }: { conversationId: string; messageId: string; kind: 'IMAGE' | 'VIDEO' }) {
  const media = useMessageMedia(conversationId, messageId, kind === 'IMAGE');
  return (
    <span className={`replythumb${kind === 'VIDEO' ? ' replythumb--video' : ''}`} aria-hidden="true">
      {kind === 'IMAGE' && media.url ? <img src={media.url} alt="" draggable={false} /> : null}
      {kind === 'VIDEO' ? <PlayIcon /> : null}
    </span>
  );
}

/** Miniatura quadrada para a aba Mídia. */
export function MediaThumb({ conversationId, messageId, kind, label, gallery }: { conversationId: string; messageId: string; kind: 'IMAGE' | 'VIDEO'; label: string; gallery?: GalleryItem[] }) {
  const browse = gallery !== undefined && gallery.length > 1;
  const isVideo = kind === 'VIDEO';
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  const media = useMessageMedia(conversationId, messageId, !isVideo || wanted);
  useEffect(() => {
    if (wanted && media.url) setOpen(true);
  }, [wanted, media.url]);
  return (
    <>
      <button
        type="button"
        className="mediathumb"
        aria-label={`${isVideo ? t('Assistir vídeo') : 'Abrir foto'}. ${label}`}
        onClick={() => {
          if (browse) return setOpen(true);
          setWanted(true);
          if (media.url) setOpen(true);
        }}
      >
        {!isVideo && media.url ? <img src={media.url} alt="" className="mediathumb__img" /> : null}
        {isVideo ? <PlayIcon /> : !media.url ? <span className="mediathumb__wait">{media.failed ? '!' : '…'}</span> : null}
      </button>
      {open && browse ? (
        <MediaGallery conversationId={conversationId} items={gallery} startId={messageId} onClose={() => setOpen(false)} />
      ) : open && media.url ? (
        <MediaViewer kind={kind} url={media.url} label={label} onClose={() => { setOpen(false); setWanted(false); }} />
      ) : null}
    </>
  );
}
