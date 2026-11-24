import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { swipeAxis } from '../lib/media-gallery.ts';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon } from './icons.tsx';
import { api } from '../client.ts';
import type { PostImage } from '../lib/types.ts';
import { rememberScroll } from '../router.tsx';
import { fetchImage, saveImages } from '../lib/save-file.ts';
import { showToast } from '../lib/toast.ts';
import { t } from '../lib/i18n/index.ts';

/** Arrasto vertical a partir do qual a foto fecha. */
const CLOSE_DRAG = 120;

/**
 * O "voltar" do aparelho (e do navegador) fecha a tela cheia em vez de sair da página.
 * O React (StrictMode, em desenvolvimento) monta, desmonta e monta de novo na hora: por isso o "voltar" da saída
 * espera um instante e só acontece se a foto não reabriu, e a reabertura reaproveita a entrada do histórico.
 */
export function useCloseOnBack(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const mounts = useRef(0);
  useEffect(() => {
    mounts.current += 1;
    const mount = mounts.current;
    const onViewerEntry = () => (window.history.state as { photoViewer?: boolean } | null)?.photoViewer === true;
    rememberScroll();
    if (!onViewerEntry()) window.history.pushState({ photoViewer: true }, '');
    let closedByBack = false;
    const onPop = () => {
      if (onViewerEntry()) return;
      closedByBack = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = overflow;
      if (closedByBack) return;
      window.setTimeout(() => {
        if (mounts.current === mount && onViewerEntry()) window.history.back();
      }, 0);
    };
  }, []);
}

/**
 * Fotos do post em tela cheia: arrasta para o lado entre as fotos, pinça para dar zoom,
 * fecha no X, no Esc, arrastando para baixo ou no "voltar" do aparelho.
 */
export function PhotoViewer({ images, start, onClose, downloadName }: { images: PostImage[]; start: number; onClose: () => void; /** Com nome: mostra o botão de baixar (só fotos enviadas, nunca as do Google). */ downloadName?: string }) {
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

  useCloseOnBack(onClose);

  // Arrastar para baixo (ou para cima) fecha, como nas fotos do chat. Com zoom de pinça, o arrasto é para andar na foto.
  const rootRef = useRef<HTMLDivElement>(null);
  const pull = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | undefined; dy: number } | undefined>(undefined);
  function paintPull(dy: number, animate: boolean) {
    const el = track.current;
    const root = rootRef.current;
    if (el) {
      el.style.transition = animate ? 'transform 200ms ease' : 'none';
      el.style.transform = dy ? `translateY(${dy}px)` : '';
    }
    if (root) root.style.backgroundColor = `rgb(0 0 0 / ${Math.max(0.3, 1 - Math.abs(dy) / 400)})`;
  }
  function pullDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (pull.current) {
      // Segundo dedo: é pinça, não arrasto.
      pull.current = undefined;
      paintPull(0, true);
      return;
    }
    if ((window.visualViewport?.scale ?? 1) > 1.01) return;
    if ((e.target as HTMLElement).closest('button')) return;
    pull.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: undefined, dy: 0 };
  }
  function pullMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.axis) {
      p.axis = swipeAxis(e.clientX - p.x, e.clientY - p.y);
      if (p.axis === 'x') pull.current = undefined;
      if (p.axis !== 'y') return;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    p.dy = e.clientY - p.y;
    paintPull(p.dy, false);
  }
  function pullUp(e: ReactPointerEvent<HTMLDivElement>) {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    pull.current = undefined;
    if (p.axis !== 'y') return;
    if (e.type === 'pointerup' && Math.abs(p.dy) > CLOSE_DRAG) return onClose();
    paintPull(0, true);
  }

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

  const [saving, setSaving] = useState(false);
  const current = photos[index];
  const canDownload = downloadName !== undefined && current?.kind === 'UPLOAD';
  async function download() {
    if (!current?.path || saving) return;
    setSaving(true);
    try {
      const src = /^(https?:|blob:|data:)/.test(current.path) ? current.path : api.assetUrl(current.path);
      const blob = await fetchImage(src);
      const name = photos.length > 1 ? `${downloadName}-${index + 1}` : downloadName!;
      if (await saveImages([{ blob, name }])) showToast(t('Foto salva'), 1400);
    } catch {
      showToast(t('Não foi possível baixar a foto.'), 2000);
    }
    setSaving(false);
  }

  if (photos.length === 0) return null;
  return createPortal(
    <div
      ref={rootRef}
      className="photoview"
      role="dialog"
      aria-modal="true"
      aria-label={t('Foto em tela cheia')}
      onPointerDown={pullDown}
      onPointerMove={pullMove}
      onPointerUp={pullUp}
      onPointerCancel={pullUp}
    >
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
            <img src={/^(https?:|blob:|data:)/.test(photo.path!) ? photo.path! : api.assetUrl(photo.path!)} alt="" referrerPolicy="no-referrer" draggable={false} />
            {photo.kind === 'PLACE' ? <figcaption>{t('Foto:')} {photo.photoAuthor ? `${photo.photoAuthor} · ` : ''}Google</figcaption> : null}
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
        <span className="photoview__actions">
          {canDownload ? (
            <button type="button" className="photoview__btn" onClick={() => void download()} disabled={saving} aria-label={t('Baixar foto')}>
              <DownloadIcon />
            </button>
          ) : null}
          <button type="button" className="photoview__btn" onClick={onClose} aria-label={t('Fechar')}>
            <XIcon />
          </button>
        </span>
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

/** Foto de perfil em tela cheia (mesmo visualizador das fotos de post). */
export function AvatarViewer({ url, onClose, downloadName }: { url: string; onClose: () => void; downloadName?: string }) {
  return <PhotoViewer images={[{ id: 'avatar', kind: 'UPLOAD', path: url, photoAuthor: null }]} start={0} onClose={onClose} downloadName={downloadName} />;
}
