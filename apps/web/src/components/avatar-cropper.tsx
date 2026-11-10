import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './icons.tsx';
import { AVATAR_ZOOM_MAX, clampView, initialAvatarView, panView, shownSize, viewToCrop, zoomView } from '../lib/avatar-crop.ts';
import type { AvatarView } from '../lib/avatar-crop.ts';
import { cropProfilePhoto } from '../lib/image.ts';
import { rememberScroll } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Tela cheia para enquadrar a foto de perfil, no padrão do Instagram/TikTok/Facebook:
 * círculo fixo no meio, a foto se mexe por baixo (arrastar, pinçar, rodinha ou slider),
 * grade de terços enquanto mexe, Cancelar à esquerda e Salvar à direita.
 * Entrega a foto já recortada (data URL JPEG quadrada, no limite da API).
 */
export function AvatarCropper({ file, onDone, onCancel }: { file: File; onDone: (image: string) => void | Promise<void>; onCancel: () => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [natural, setNatural] = useState<{ w: number; h: number }>();
  const [failed, setFailed] = useState<string>();
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState<AvatarView>(initialAvatarView);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // Lê o tamanho real da foto (já com a rotação do EXIF que o navegador aplica).
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        if (!cancelled) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      })
      .catch(() => {
        if (!cancelled) setFailed(t('Não foi possível ler essa imagem. Tente uma foto JPEG ou PNG.'));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // O quadro é o maior quadrado que cabe na área livre (com respiro nas bordas).
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setFrame(Math.max(120, Math.floor(Math.min(el.clientWidth - 32, el.clientHeight - 32, 520))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Se o quadro mudar de tamanho (girar o aparelho), mantém o mesmo enquadramento proporcional.
  const lastFrame = useRef(0);
  useEffect(() => {
    if (!natural || frame === 0) return;
    const prev = lastFrame.current;
    lastFrame.current = frame;
    if (prev > 0 && prev !== frame) {
      const k = frame / prev;
      setView((v) => clampView({ zoom: v.zoom, x: v.x * k, y: v.y * k }, frame, natural.w, natural.h));
    }
  }, [frame, natural]);

  // Esc e o "voltar" do aparelho cancelam, sem sair da página.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    const isOurs = () => (window.history.state as { avatarCrop?: boolean } | null)?.avatarCrop === true;
    rememberScroll();
    if (!isOurs()) window.history.pushState({ avatarCrop: true }, '');
    let closedByBack = false;
    const onPop = () => {
      if (isOurs()) return;
      closedByBack = true;
      cancelRef.current();
    };
    window.addEventListener('popstate', onPop);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = overflow;
      if (!closedByBack) {
        // Espera um instante: no StrictMode o React monta de novo na hora e reaproveita a entrada.
        window.setTimeout(() => {
          if (isOurs() && !document.querySelector('.avatarcrop')) window.history.back();
        }, 0);
      }
    };
  }, []);

  // Rodinha do mouse / pinça do trackpad: zoom no ponto do cursor.
  useEffect(() => {
    const el = stage.current;
    if (!el || !natural || frame === 0) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const v = viewRef.current;
      setView(zoomView(v, v.zoom * Math.exp(-event.deltaY * 0.002), frame, natural.w, natural.h, px, py));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [natural, frame]);

  const ready = natural !== undefined && frame > 0;

  function center(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (!ready || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: viewRef.current.zoom };
    }
    setMoving(true);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(event.pointerId);
    if (!prev || !natural) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const { cx, cy } = center(event.currentTarget);
      const mid = { x: (a!.x + b!.x) / 2 - cx, y: (a!.y + b!.y) / 2 - cy };
      // Pinça dá zoom no meio dos dedos; mover os dois dedos juntos também arrasta.
      const zoomed = zoomView(viewRef.current, pinch.current.zoom * (dist / Math.max(1, pinch.current.dist)), frame, natural.w, natural.h, mid.x, mid.y);
      setView(panView(zoomed, (next.x - prev.x) / 2, (next.y - prev.y) / 2, frame, natural.w, natural.h));
      return;
    }
    setView(panView(viewRef.current, next.x - prev.x, next.y - prev.y, frame, natural.w, natural.h));
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setMoving(false);
  }

  function setZoom(zoom: number) {
    if (!natural) return;
    setView(zoomView(viewRef.current, zoom, frame, natural.w, natural.h));
  }

  async function save() {
    if (!natural || busy) return;
    setBusy(true);
    setFailed(undefined);
    try {
      const image = await cropProfilePhoto(url, viewToCrop(viewRef.current, frame, natural.w, natural.h));
      await onDone(image);
    } catch (failure) {
      setFailed(failure instanceof Error ? failure.message : t('Não foi possível recortar a foto.'));
      setBusy(false);
    }
  }

  const size = ready ? shownSize(view, frame, natural.w, natural.h) : { w: 0, h: 0 };

  return createPortal(
    <div className="avatarcrop" role="dialog" aria-modal="true" aria-label={t('Ajustar foto de perfil')}>
      <header className="avatarcrop__head">
        <button type="button" className="avatarcrop__cancel" onClick={onCancel} disabled={busy} aria-label={t('Cancelar')}>
          <XIcon />
        </button>
        <h2 className="avatarcrop__title">{t('Mover e ajustar')}</h2>
        <button type="button" className="avatarcrop__save" onClick={() => void save()} disabled={!ready || busy} aria-busy={busy}>
          {busy ? t('Salvando…') : t('Salvar')}
        </button>
      </header>
      <div
        ref={stage}
        className={`avatarcrop__stage${moving ? ' avatarcrop__stage--moving' : ''}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(event) => {
          if (!natural) return;
          const { cx, cy } = center(event.currentTarget);
          const v = viewRef.current;
          setView(zoomView(v, v.zoom > 1.5 ? 1 : 2.5, frame, natural.w, natural.h, event.clientX - cx, event.clientY - cy));
        }}
      >
        {ready ? (
          <>
            <img
              className="avatarcrop__img"
              src={url}
              alt=""
              draggable={false}
              style={{ width: size.w, height: size.h, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px)` }}
            />
            <div className="avatarcrop__mask" style={{ width: frame, height: frame }} aria-hidden="true">
              <span className="avatarcrop__grid" />
            </div>
          </>
        ) : failed ? null : (
          <span className="avatarcrop__loading" aria-live="polite">
            {t('Carregando…')}
          </span>
        )}
      </div>
      <footer className="avatarcrop__foot">
        {failed ? (
          <p className="avatarcrop__error" role="alert">
            {failed}
          </p>
        ) : (
          <p className="avatarcrop__hint">{t('Arraste para mover e pince para dar zoom')}</p>
        )}
        <label className="avatarcrop__zoom">
          <span className="visually-hidden">{t('Zoom')}</span>
          <span aria-hidden="true" className="avatarcrop__zoomicon avatarcrop__zoomicon--small" />
          <input type="range" min={1} max={AVATAR_ZOOM_MAX} step={0.01} value={view.zoom} disabled={!ready || busy} onChange={(event) => setZoom(Number(event.target.value))} />
          <span aria-hidden="true" className="avatarcrop__zoomicon" />
        </label>
      </footer>
    </div>,
    document.body,
  );
}
