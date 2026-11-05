import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from './icons.tsx';
import { api } from '../client.ts';
import type { PostImage } from '../lib/types.ts';
import { rememberScroll } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Fotos do post em tela cheia: arrasta para o lado entre as fotos, pinça para dar zoom,
 * fecha no X, no Esc ou no "voltar" do aparelho.
 */
export function PhotoViewer({ images, start, onClose }: { images: PostImage[]; start: number; onClose: () => void }) {
  const photos = images.filter((image) => image.path && !image.videoPath);
  const first = Math.max(0, photos.findIndex((p) => p.id === images[start]?.id));
  const [index, setIndex] = useState(first);
  const track = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Começa na foto tocada, sem animação.
  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = first * el.clientWidth;
  }, [first]);

  // O "voltar" do aparelho fecha a foto em vez de sair da página.
  useEffect(() => {
    rememberScroll();
    window.history.pushState({ photoViewer: true }, '');
    let closedByBack = false;
    const onPop = () => {
      closedByBack = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = overflow;
      if (!closedByBack && (window.history.state as { photoViewer?: boolean } | null)?.photoViewer) window.history.back();
    };
  }, []);

  function go(to: number) {
    const el = track.current;
    if (!el) return;
    const next = Math.min(photos.length - 1, Math.max(0, to));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'ArrowRight') go(index + 1);
      if (event.key === 'ArrowLeft') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (photos.length === 0) return null;
  return createPortal(
    <div className="photoview" role="dialog" aria-modal="true" aria-label={t('Foto em tela cheia')}>
      <div
        className="photoview__track"
        ref={track}
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {photos.map((photo, i) => (
          <figure key={photo.id} className="photoview__slide" aria-label={t('Foto {index} de {total}', { index: i + 1, total: photos.length })}>
            <img src={api.assetUrl(photo.path!)} alt="" referrerPolicy="no-referrer" draggable={false} />
            {photo.kind === 'PLACE' ? <figcaption>Foto: {photo.photoAuthor ? `${photo.photoAuthor} · ` : ''}Google</figcaption> : null}
          </figure>
        ))}
      </div>
      <header className="photoview__head">
        {photos.length > 1 ? (
          <span className="photoview__count" aria-live="polite">
            {index + 1} / {photos.length}
          </span>
        ) : (
          <span />
        )}
        <button type="button" className="photoview__btn" onClick={onClose} aria-label={t('Fechar')}>
          <XIcon />
        </button>
      </header>
      {photos.length > 1 ? (
        <>
          <button type="button" className="photoview__nav photoview__nav--prev" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t('Foto anterior')}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="photoview__nav photoview__nav--next" onClick={() => go(index + 1)} disabled={index === photos.length - 1} aria-label={t('Próxima foto')}>
            <ChevronRightIcon />
          </button>
          <div className="photoview__dots" aria-hidden="true">
            {photos.map((photo, i) => (
              <span key={photo.id} className={`photoview__dot${i === index ? ' photoview__dot--on' : ''}`} />
            ))}
          </div>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
