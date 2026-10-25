import { useEffect, useState } from 'react';
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

/** Foto ou vídeo em tela cheia. Esc ou o X fecham. */
export function MediaViewer({ kind, url, label, onClose }: { kind: 'IMAGE' | 'VIDEO'; url: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="mediaviewer" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <button type="button" className="mediaviewer__close iconbtn" aria-label={t('Fechar')} onClick={onClose}>
        <XIcon />
      </button>
      {kind === 'IMAGE' ? (
        <img className="mediaviewer__media" src={url} alt={label} onClick={(e) => e.stopPropagation()} />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video className="mediaviewer__media" src={url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

/** Foto ou vídeo dentro do balão: a foto aparece sozinha; o vídeo baixa quando a pessoa toca. */
export function MediaBubble({ message, conversationId }: { message: Pick<ChatMessage, 'id' | 'kind' | 'senderName' | 'mine'>; conversationId: string }) {
  const isVideo = message.kind === 'VIDEO';
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
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
        onClick={() => {
          if (isVideo) {
            setWanted(true);
            if (media.url) setOpen(true);
          } else if (media.url) {
            setOpen(true);
          }
        }}
      >
        {!isVideo && media.url ? <img src={media.url} alt="" className="mediabubble__img" /> : null}
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
