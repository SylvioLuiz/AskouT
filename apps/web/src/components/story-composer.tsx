import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { BackIcon, CameraIcon, PhotoIcon, PlayIcon, XIcon } from './icons.tsx';
import { api } from '../client.ts';
import { ApiError, toApiError } from '../lib/errors.ts';
import { mediaKind, prepareImage } from '../lib/chat-media.ts';
import { clampCaptionY, durationLabel, nativeGallery } from '../lib/gallery.ts';
import type { GalleryAccess, GalleryItem, NativeGallery } from '../lib/gallery.ts';
import { isVideoFile, POST_VIDEO_MAX_BYTES, videoPoster, videoProblem } from '../lib/post-video.ts';
import { prepareVideoUpload, withMediaType } from '../lib/media-file.ts';
import { canCompressVideo, prepareProgressText } from '../lib/video-prepare.ts';
import { t } from '../lib/i18n/index.ts';

/** Mesmo limite da API: texto curto por cima da mídia. */
const CAPTION_MAX = 200;
/** Miniaturas por página da grade. */
const PAGE = 60;

type Picked = { blob: Blob; kind: 'IMAGE' | 'VIDEO'; url: string; seconds?: number };

function problemText(failure: unknown): string {
  return failure instanceof Error && failure.message !== 'grande' && failure.message !== 'canvas' ? failure.message : t('Não foi possível usar este arquivo. Tente outro.');
}

/**
 * Criar story, em tela cheia, no estilo do Instagram:
 * 1. Escolher: grade da galeria dentro do app (quando a casca nativa oferece) com a câmera no primeiro quadrado;
 *    sem galeria nativa (navegador, Android), botões para a galeria e a câmera do sistema.
 * 2. Editar: a mídia na tela inteira, com "Aa" para escrever um texto por cima (arrasta para subir ou descer).
 * 3. Publicar só no evento ou também no perfil.
 */
export function StoryComposer({ eventId, onClose, onCreated }: { eventId: string; onClose: () => void; onCreated: () => void }) {
  const gallery = useRef<NativeGallery | undefined>(nativeGallery()).current;
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | undefined>();
  const [loadingId, setLoadingId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [prep, setPrep] = useState<number | undefined>();
  const [caption, setCaption] = useState('');
  const [captionY, setCaptionY] = useState(0.5);
  const [writing, setWriting] = useState(false);

  useEffect(() => () => picked && URL.revokeObjectURL(picked.url), [picked]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  /** Volta um passo: fecha o texto, depois volta para a galeria, depois fecha. */
  const back = useCallback(() => {
    if (busy) return;
    if (writing) setWriting(false);
    else if (picked && gallery) {
      setPicked(undefined);
      setCaption('');
      setCaptionY(0.5);
      setProblem(undefined);
    } else onClose();
  }, [busy, writing, picked, gallery, onClose]);
  const backRef = useRef(back);
  backRef.current = back;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') backRef.current();
    };
    // Botão voltar do Android: a casca avisa antes de voltar a página; cancelar o evento faz só o passo daqui.
    const onBack = (event: Event) => {
      event.preventDefault();
      backRef.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('askout:back', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('askout:back', onBack);
    };
  }, []);

  async function use(chosen: File) {
    const file = withMediaType(chosen);
    setProblem(undefined);
    const kind = mediaKind(file);
    if (kind === 'VIDEO' || isVideoFile(file)) {
      // Como nos posts: vídeo grande serve se este aparelho conseguir reduzir antes de enviar.
      const bad = videoProblem(file, { canCompress: file.size > POST_VIDEO_MAX_BYTES ? await canCompressVideo() : false });
      if (bad) throw new Error(bad);
      const { seconds } = await videoPoster(file); // confere a duração (até 3 minutos)
      setPicked({ blob: file, kind: 'VIDEO', url: URL.createObjectURL(file), seconds });
    } else if (kind === 'IMAGE') {
      const blob = await prepareImage(file);
      setPicked({ blob, kind: 'IMAGE', url: URL.createObjectURL(blob) });
    } else {
      throw new Error(t('Escolha uma foto ou um vídeo.'));
    }
  }

  async function onInput(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setBusy(true);
    try {
      await use(chosen);
    } catch (failure) {
      setProblem(problemText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function fromGallery(item: GalleryItem) {
    if (!gallery || loadingId) return;
    setLoadingId(item.id);
    setProblem(undefined);
    try {
      await use(await gallery.file(item.id));
    } catch (failure) {
      setProblem(problemText(failure));
    } finally {
      setLoadingId(undefined);
    }
  }

  async function publish(onProfile: boolean) {
    if (!picked) return;
    setBusy(true);
    setProblem(undefined);
    try {
      let blob = picked.blob;
      if (picked.kind === 'VIDEO' && blob instanceof File) {
        setPrep(0);
        blob = await prepareVideoUpload(blob, (fraction) => setPrep(fraction), picked.seconds);
        setPrep(undefined);
      }
      const text = caption.trim();
      await api.createEventStory(eventId, blob, onProfile, text ? { caption: text, captionY } : undefined);
      onCreated();
    } catch (failure) {
      setPrep(undefined);
      setProblem(failure instanceof Error && !(failure instanceof ApiError) ? failure.message : toApiError(failure).message);
      setBusy(false);
    }
  }

  const inputs = (
    <>
      <input ref={fileRef} type="file" accept="image/*,video/*" className="visually-hidden" onChange={(event) => void onInput(event)} aria-label={t('Escolher foto ou vídeo')} tabIndex={-1} />
      <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" className="visually-hidden" onChange={(event) => void onInput(event)} aria-label={t('Tirar foto ou gravar vídeo')} tabIndex={-1} />
    </>
  );

  if (!picked) {
    return (
      <div className="storycomp" role="dialog" aria-modal="true" aria-label={t('Novo story')}>
        {inputs}
        <header className="storycomp__head">
          <button type="button" className="storycomp__icon" onClick={onClose} aria-label={t('Fechar')}>
            <XIcon />
          </button>
          <h2 className="storycomp__title">{t('Novo story')}</h2>
          <span className="storycomp__icon" aria-hidden="true" />
        </header>
        {gallery ? (
          <GalleryGrid gallery={gallery} loadingId={loadingId} busy={busy} onPick={(item) => void fromGallery(item)} onCamera={() => cameraRef.current?.click()} onOther={() => fileRef.current?.click()} />
        ) : (
          <div className="storycomp__start">
            <p className="storycomp__lead">{t('Foto ou vídeo. Qualquer pessoa do evento vê, fica no ar por 24 h e some quando o evento acabar.')}</p>
            <div className="storycomp__choices">
              <button type="button" className="storycomp__choice" disabled={busy} onClick={() => fileRef.current?.click()}>
                <PhotoIcon />
                <span>{t('Galeria')}</span>
              </button>
              <button type="button" className="storycomp__choice" disabled={busy} onClick={() => cameraRef.current?.click()}>
                <CameraIcon />
                <span>{t('Câmera')}</span>
              </button>
            </div>
            {busy ? <span className="storycomp__spinner" role="status" aria-label={t('Abrindo')} /> : null}
          </div>
        )}
        {problem ? <p className="storycomp__error" role="alert">{problem}</p> : null}
      </div>
    );
  }

  return (
    <div className="storycomp storycomp--edit" role="dialog" aria-modal="true" aria-label={t('Editar story')}>
      {inputs}
      <div className="storycomp__stage">
        {picked.kind === 'VIDEO' ? <video className="storycomp__media" src={picked.url} autoPlay loop playsInline muted /> : <img className="storycomp__media" src={picked.url} alt={t('Prévia do story')} />}
        {caption.trim() && !writing ? <DraggableCaption text={caption} y={captionY} onMove={setCaptionY} onEdit={() => setWriting(true)} disabled={busy} /> : null}
      </div>
      <header className="storycomp__head storycomp__head--over">
        <button type="button" className="storycomp__icon storycomp__icon--glass" onClick={back} disabled={busy} aria-label={gallery ? t('Voltar para a galeria') : t('Fechar')}>
          {gallery ? <BackIcon /> : <XIcon />}
        </button>
        <span className="storycomp__spacer" />
        {!gallery ? (
          <button type="button" className="storycomp__icon storycomp__icon--glass" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={t('Trocar foto ou vídeo')}>
            <PhotoIcon />
          </button>
        ) : null}
        <button type="button" className="storycomp__icon storycomp__icon--glass storycomp__aa" onClick={() => setWriting(true)} disabled={busy} aria-label={caption.trim() ? t('Editar texto') : t('Escrever um texto')}>
          Aa
        </button>
      </header>
      {writing ? <CaptionEditor initial={caption} onDone={(text) => { setCaption(text); setWriting(false); }} /> : null}
      {!writing ? (
        <footer className="storycomp__foot">
          {prep !== undefined ? (
            <div className="uploadbar storycomp__prep" role="status" aria-live="polite">
              <progress className="uploadbar__bar" max={1} value={prep} aria-label={t('Otimização do vídeo')} />
              <p className="uploadbar__text">{prepareProgressText(prep)}</p>
            </div>
          ) : null}
          {problem ? <p className="storycomp__error storycomp__error--inline" role="alert">{problem}</p> : null}
          {!caption.trim() ? (
            <button type="button" className="storycomp__hint" onClick={() => setWriting(true)} disabled={busy}>
              {t('Toque em Aa para escrever uma mensagem')}
            </button>
          ) : null}
          <div className="storycomp__publish" role="group" aria-label={t('Onde publicar')}>
            <button type="button" className="storycomp__pub storycomp__pub--event" disabled={busy} onClick={() => void publish(false)}>
              <span>{t('Só no evento')}</span>
            </button>
            <button type="button" className="storycomp__pub storycomp__pub--profile" disabled={busy} onClick={() => void publish(true)}>
              {busy ? <span className="storycomp__spinner storycomp__spinner--small" aria-hidden="true" /> : null}
              <span>{t('Evento e perfil')}</span>
            </button>
          </div>
          <p className="storycomp__note">{t('No perfil, seus amigos também veem na página inicial.')}</p>
        </footer>
      ) : null}
    </div>
  );
}

// ---------- Galeria ----------

function GalleryGrid({ gallery, loadingId, busy, onPick, onCamera, onOther }: { gallery: NativeGallery; loadingId?: string; busy: boolean; onPick: (item: GalleryItem) => void; onCamera: () => void; onOther: () => void }) {
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
      const page = await gallery.recent({ offset, limit: PAGE });
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

// ---------- Texto ----------

/** Escrever o texto: tela escurecida com o campo no meio, como no Instagram. */
function CaptionEditor({ initial, onDone }: { initial: string; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // O campo cresce com o texto (sem barra de rolagem).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const left = CAPTION_MAX - Array.from(text).length;
  return (
    <div className="storytext" role="dialog" aria-label={t('Texto do story')}>
      <div className="storytext__top">
        <span className={`storytext__count${left < 20 ? ' storytext__count--low' : ''}`} aria-live="polite">{left}</span>
        <button type="button" className="storytext__done" onClick={() => onDone(text.trim())}>
          {t('Concluir')}
        </button>
      </div>
      <div className="storytext__center" onClick={(event) => event.target === event.currentTarget && onDone(text.trim())}>
        <textarea
          ref={ref}
          className="storytext__input"
          value={text}
          rows={1}
          maxLength={CAPTION_MAX}
          placeholder={t('Escreva algo…')}
          aria-label={t('Mensagem do story')}
          onChange={(event) => setText(Array.from(event.target.value).slice(0, CAPTION_MAX).join(''))}
        />
      </div>
    </div>
  );
}

/** O texto por cima da mídia: arraste para cima ou para baixo; toque para editar. */
function DraggableCaption({ text, y, onMove, onEdit, disabled }: { text: string; y: number; onMove: (y: number) => void; onEdit: () => void; disabled: boolean }) {
  const drag = useRef<{ id: number; startY: number; startRatio: number; height: number; moved: boolean } | undefined>(undefined);

  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    const stage = event.currentTarget.parentElement;
    drag.current = { id: event.pointerId, startY: event.clientY, startRatio: y, height: stage?.clientHeight || window.innerHeight, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dy = event.clientY - d.startY;
    if (Math.abs(dy) > 6) d.moved = true;
    if (d.moved) onMove(clampCaptionY(d.startRatio + dy / d.height));
  }
  function up(event: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = undefined;
    if (d && d.id === event.pointerId && !d.moved) onEdit();
  }

  return (
    <button
      type="button"
      className="storycaption storycaption--edit"
      style={{ top: `${y * 100}%` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (drag.current = undefined)}
      onClick={(event) => event.detail === 0 && onEdit()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') onMove(clampCaptionY(y - 0.05));
        else if (event.key === 'ArrowDown') onMove(clampCaptionY(y + 0.05));
        else return;
        event.preventDefault();
      }}
      disabled={disabled}
      aria-label={t('Texto do story: {text}. Toque para editar, arraste para mover.', { text })}
    >
      <span className="storycaption__text">{text}</span>
    </button>
  );
}

/** O texto no story publicado (só para ver; não pega toques). */
export function StoryCaption({ text, y }: { text: string; y: number | null | undefined }) {
  return (
    <p className="storycaption" style={{ top: `${clampCaptionY(y ?? 0.5) * 100}%` }}>
      <span className="storycaption__text">{text}</span>
    </p>
  );
}
