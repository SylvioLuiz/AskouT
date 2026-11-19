import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraIcon, PhotoIcon, PlayIcon } from './icons.tsx';
import { clampCaptionY, durationLabel } from '../lib/gallery.ts';
import type { GalleryAccess, GalleryItem, NativeGallery } from '../lib/gallery.ts';
import { t } from '../lib/i18n/index.ts';

/**
 * Galeria do aparelho dentro do app (grade das fotos e vídeos recentes, como no Instagram), quando a casca
 * nativa oferece `window.AskouTGallery` (hoje, no iPhone). Também mostra o texto único dos stories da versão anterior.
 */

/** Miniaturas por página da grade: a primeira é curta para a grade aparecer logo. */
const FIRST_PAGE = 21;
const PAGE = 45;

// ---------- Galeria ----------

export function GalleryGrid({ gallery, loadingId, busy, onPick, onCamera, onOther }: { gallery: NativeGallery; loadingId?: string; busy: boolean; onPick: (item: GalleryItem) => void; onCamera: () => void; onOther: () => void }) {
  const [access, setAccess] = useState<GalleryAccess | undefined>();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ loading: false, more: true, offset: 0 });

  const load = useCallback(async (reset = false) => {
    const s = stateRef.current;
    if (s.loading || (!reset && !s.more)) return;
    s.loading = true;
    setLoading(true);
    try {
      const offset = reset ? 0 : s.offset;
      const page = await gallery.recent({ offset, limit: offset === 0 ? FIRST_PAGE : PAGE });
      s.offset = offset + page.items.length;
      s.more = page.more && page.items.length > 0;
      setMore(s.more);
      setItems((current) => (reset ? page.items : [...current, ...page.items]));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      s.loading = false;
      setLoading(false);
    }
  }, [gallery]);

  // Ao abrir: confere (e pede, na primeira vez) o acesso às fotos e carrega as mais recentes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let state: GalleryAccess;
      try {
        state = await gallery.access();
        if (state === 'prompt') state = await gallery.request();
      } catch {
        state = 'denied';
      }
      if (cancelled) return;
      setAccess(state);
      if (state === 'full' || state === 'limited') await load(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [gallery, load]);

  // Rolagem infinita: carrega a próxima página quando o fim da grade aparece.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load();
    }, { rootMargin: '600px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [load, items.length]);

  async function manage() {
    try {
      await gallery.manage();
    } finally {
      await load(true);
    }
  }

  if (access === undefined) return <div className="storygrid__empty"><span className="storycomp__spinner" role="status" aria-label={t('Abrindo a galeria')} /></div>;

  if (access === 'denied') {
    return (
      <div className="storygrid__empty">
        <PhotoIcon />
        <p><strong>{t('Libere suas fotos para ver a galeria aqui')}</strong></p>
        <p className="storycomp__lead">{t('Nos Ajustes do iPhone, permita que o AskouT acesse suas fotos. Ou escolha uma foto sem liberar o acesso.')}</p>
        <div className="storycomp__choices">
          <button type="button" className="storycomp__choice" onClick={() => void gallery.openSettings()}>
            <span>{t('Abrir Ajustes')}</span>
          </button>
          <button type="button" className="storycomp__choice" disabled={busy} onClick={onOther}>
            <PhotoIcon />
            <span>{t('Escolher foto')}</span>
          </button>
          <button type="button" className="storycomp__choice" disabled={busy} onClick={onCamera}>
            <CameraIcon />
            <span>{t('Câmera')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="storygrid">
      <div className="storygrid__bar">
        <strong>{t('Recentes')}</strong>
        <button type="button" className="storygrid__link" onClick={onOther} disabled={busy}>
          {t('Outros arquivos')}
        </button>
      </div>
      {access === 'limited' ? (
        <div className="storygrid__limited">
          <span>{t('Você liberou só algumas fotos para o AskouT.')}</span>
          <button type="button" className="storygrid__link" onClick={() => void manage()}>
            {t('Gerenciar')}
          </button>
        </div>
      ) : null}
      <div className="storygrid__scroll">
        <ul className="storygrid__list" role="list">
          <li>
            <button type="button" className="storygrid__cell storygrid__camera" onClick={onCamera} disabled={busy} aria-label={t('Abrir a câmera')}>
              <CameraIcon />
              <span>{t('Câmera')}</span>
            </button>
          </li>
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={`storygrid__cell${loadingId === item.id ? ' storygrid__cell--loading' : ''}`}
                onClick={() => onPick(item)}
                disabled={!!loadingId || busy}
                aria-label={item.kind === 'VIDEO' ? t('Vídeo de {duration}', { duration: durationLabel(item.seconds) }) : t('Foto {n}', { n: index + 1 })}
              >
                <img src={item.thumb} alt="" loading="lazy" decoding="async" draggable={false} />
                {item.kind === 'VIDEO' ? (
                  <span className="storygrid__dur">
                    <PlayIcon />
                    {durationLabel(item.seconds)}
                  </span>
                ) : null}
                {loadingId === item.id ? <span className="storycomp__spinner storycomp__spinner--small" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {!loading && items.length === 0 && !failed ? <p className="storygrid__none">{t('Nenhuma foto ou vídeo por aqui ainda.')}</p> : null}
        {failed ? (
          <p className="storygrid__none">
            {t('Não foi possível abrir a galeria.')}{' '}
            <button type="button" className="storygrid__link" onClick={() => void load(items.length === 0)}>
              {t('Tentar de novo')}
            </button>
          </p>
        ) : null}
        <div ref={sentinelRef} className="storygrid__sentinel" aria-hidden="true">
          {loading && more ? <span className="storycomp__spinner storycomp__spinner--small" /> : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Texto da versão anterior ----------

/** O texto no story publicado (só para ver; não pega toques). */
export function StoryCaption({ text, y }: { text: string; y: number | null | undefined }) {
  return (
    <p className="storycaption" style={{ top: `${clampCaptionY(y ?? 0.5) * 100}%` }}>
      <span className="storycaption__text">{text}</span>
    </p>
  );
}
