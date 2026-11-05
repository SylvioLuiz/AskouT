import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { DOUBLE_TAP_MS } from '../lib/chat.ts';
import { api } from '../client.ts';
import { PlayIcon, XIcon } from './icons.tsx';
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

/**
 * Foto ou vídeo em tela cheia, por cima de tudo (vai direto para o <body>, para nenhum balão "prender" a tela).
 * Foto: pinça para dar zoom, arrastar para andar com zoom, toque duplo alterna o zoom e arrastar para baixo fecha.
 * Esc, o X ou tocar fora da foto também fecham.
 */
export function MediaViewer({ kind, url, label, onClose }: { kind: 'IMAGE' | 'VIDEO'; url: string; label: string; onClose: () => void }) {
  const mediaRef = useRef<HTMLImageElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0, drop: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | undefined>(undefined);
  const lastTap = useRef<{ at: number; x: number; y: number } | undefined>(undefined);
  const moved = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const body = document.body.style;
    const before = body.overflow;
    body.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      body.overflow = before;
    };
  }, [onClose]);

  function paint(animate: boolean) {
    const v = view.current;
    const img = mediaRef.current;
    if (img) {
      img.style.transition = animate ? 'transform 220ms ease' : 'none';
      img.style.transform = `translate(${v.x}px, ${v.y + v.drop}px) scale(${v.scale})`;
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
    if (kind !== 'IMAGE') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
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
        v.drop += dy;
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
    if (Math.abs(v.drop) > CLOSE_DRAG) return onClose();
    v.drop = 0;
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

  return createPortal(
    <div ref={rootRef} className="mediaviewer" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="mediaviewer__close iconbtn" aria-label={t('Fechar')} onClick={onClose}>
        <XIcon />
      </button>
      {kind === 'IMAGE' ? (
        <div className="mediaviewer__stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <img ref={mediaRef} className="mediaviewer__media" src={url} alt={label} draggable={false} />
        </div>
      ) : (
        <div className="mediaviewer__stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video className="mediaviewer__media" src={url} controls autoPlay playsInline />
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Foto ou vídeo dentro do balão: a foto aparece sozinha; o vídeo baixa quando a pessoa toca. */
export function MediaBubble({ message, conversationId, onTap }: { message: Pick<ChatMessage, 'id' | 'kind' | 'senderName' | 'mine'>; conversationId: string; onTap?: (x: number, y: number) => boolean }) {
  const isVideo = message.kind === 'VIDEO';
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(openTimer.current), []);
  const media = useMessageMedia(conversationId, message.id, !isVideo || wanted);
  const label = `${isVideo ? t('Vídeo enviado') : t('Foto enviada')} por ${message.mine ? 'você' : (message.senderName ?? 'alguém')}`;

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
        onClick={(e) => {
          const show = () => {
            if (isVideo) {
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
      {open && media.url ? (
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
export function MediaThumb({ conversationId, messageId, kind, label }: { conversationId: string; messageId: string; kind: 'IMAGE' | 'VIDEO'; label: string }) {
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
          setWanted(true);
          if (media.url) setOpen(true);
        }}
      >
        {!isVideo && media.url ? <img src={media.url} alt="" className="mediathumb__img" /> : null}
        {isVideo ? <PlayIcon /> : !media.url ? <span className="mediathumb__wait">{media.failed ? '!' : '…'}</span> : null}
      </button>
      {open && media.url ? <MediaViewer kind={kind} url={media.url} label={label} onClose={() => { setOpen(false); setWanted(false); }} /> : null}
    </>
  );
}
