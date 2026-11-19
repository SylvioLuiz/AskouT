import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CameraIcon, PhotoIcon, RefreshIcon, TrashIcon, XIcon } from './icons.tsx';
import { SoundToggle } from './sound-toggle.tsx';
import { StoryOverlayItem, useKeyboardInset, useMediaBox } from './story-overlays.tsx';
import { GalleryGrid } from './story-gallery.tsx';
import { nativeGallery } from '../lib/gallery.ts';
import type { GalleryItem } from '../lib/gallery.ts';
import { api } from '../client.ts';
import { ApiError, toApiError } from '../lib/errors.ts';
import { mediaKind, prepareImage } from '../lib/chat-media.ts';
import { isVideoFile, POST_VIDEO_MAX_BYTES, videoPoster, videoProblem } from '../lib/post-video.ts';
import { prepareVideoUpload, withMediaType } from '../lib/media-file.ts';
import { canCompressVideo, prepareProgressText } from '../lib/video-prepare.ts';
import { STORY_COLORS, STORY_OVERLAYS_MAX, STORY_OVERLAY_TEXT_MAX, STORY_STICKERS, TEXT_WRAP_RATIO, clamp, nextStyle, overTrash, overlayLook, pinch } from '../lib/story-overlays.ts';
import type { Point } from '../lib/story-overlays.ts';
import type { StoryOverlay, StoryOverlayStyle } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/** Foto ou vídeo escolhido, com o tamanho real (para encaixar os textos no lugar certo). */
interface StoryMedia {
  blob: Blob;
  kind: 'IMAGE' | 'VIDEO';
  url: string;
  seconds?: number;
  width: number;
  height: number;
}

function friendlyProblem(failure: unknown): string {
  return failure instanceof Error && failure.message !== 'grande' && failure.message !== 'canvas' ? failure.message : t('Não foi possível usar este arquivo. Tente outro.');
}

async function imageSize(url: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    // O WebView do Android às vezes recusa `decode()` num arquivo que abre normalmente: tenta ler o tamanho de outro jeito.
    const blob = await (await fetch(url)).blob();
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new Error(t('Não foi possível ler essa imagem. Tente uma foto JPEG ou PNG.'));
    }
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
}

function videoSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const fallback = { width: 9, height: 16 };
    const timer = window.setTimeout(() => resolve(fallback), 8000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve(video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : fallback);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      resolve(fallback);
    };
    video.src = url;
  });
}

/** Confere e prepara o arquivo como nos stories de antes: foto reduzida; vídeo até 3 minutos (grande só se der para reduzir). */
async function mediaFrom(chosen: File): Promise<StoryMedia> {
  const picked = withMediaType(chosen);
  const kind = mediaKind(picked);
  if (kind === 'VIDEO' || isVideoFile(picked)) {
    const bad = videoProblem(picked, { canCompress: picked.size > POST_VIDEO_MAX_BYTES ? await canCompressVideo() : false });
    if (bad) throw new Error(bad);
    const { seconds } = await videoPoster(picked);
    const url = URL.createObjectURL(picked);
    return { blob: picked, kind: 'VIDEO', url, seconds, ...(await videoSize(url)) };
  }
  if (kind === 'IMAGE') {
    const blob = await prepareImage(picked);
    const url = URL.createObjectURL(blob);
    try {
      return { blob, kind: 'IMAGE', url, ...(await imageSize(url)) };
    } catch (failure) {
      URL.revokeObjectURL(url);
      throw failure;
    }
  }
  throw new Error(t('Escolha uma foto ou um vídeo.'));
}

/**
 * Esc e o botão voltar do Android (a casca dispara `askout:back` antes de voltar a página; cancelar o evento
 * faz só um passo aqui dentro). Cada tela chama `step` quando está por cima e devolve true se tratou.
 */
function useBackStep(step: () => boolean, active = true) {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stepRef.current();
    };
    const onBack = (event: Event) => {
      if (stepRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('askout:back', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('askout:back', onBack);
    };
  }, [active]);
}

/**
 * Criar story em tela cheia, como no Instagram: primeiro a câmera (ou a galeria), depois o editor
 * com textos e figurinhas, e por fim publicar só no evento ou também no perfil.
 */
export function StoryCreator({ eventId, onClose, onCreated }: { eventId: string; onClose: () => void; onCreated: () => void }) {
  const [media, setMedia] = useState<StoryMedia | undefined>();
  useEffect(() => () => media && URL.revokeObjectURL(media.url), [media]);
  return createPortal(
    <div className="storycreate" role="dialog" aria-modal="true" aria-label={t('Criar flash')}>
      {media ? (
        <StoryEditor media={media} eventId={eventId} onBack={() => setMedia(undefined)} onCreated={onCreated} />
      ) : (
        <StoryCapture onPicked={setMedia} onClose={onClose} />
      )}
    </div>,
    document.body,
  );
}

// ---------- Câmera ----------

function StoryCapture({ onPicked, onClose }: { onPicked: (media: StoryMedia) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [camera, setCamera] = useState<'starting' | 'on' | 'off'>('starting');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  /** Galeria dentro do app (iPhone): grade das fotos recentes por cima da câmera. */
  const gallery = nativeGallery();
  const [grid, setGrid] = useState(false);
  const [loadingId, setLoadingId] = useState<string | undefined>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('off');
      return;
    }
    setCamera('starting');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play().catch(() => undefined);
        }
        setCamera('on');
      })
      .catch(() => {
        if (!cancelled) setCamera('off');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [facing]);

  // Voltar: fecha a grade da galeria; depois sai.
  useBackStep(() => {
    if (busy) return true;
    if (grid) setGrid(false);
    else onClose();
    return true;
  });

  function openGallery() {
    if (gallery) setGrid(true);
    else galleryRef.current?.click();
  }

  async function pickFromGrid(item: GalleryItem) {
    if (!gallery) return;
    setLoadingId(item.id);
    try {
      await use(await gallery.file(item.id));
    } catch (failure) {
      setProblem(friendlyProblem(failure));
    } finally {
      setLoadingId(undefined);
    }
  }

  async function use(file: File) {
    setBusy(true);
    setProblem(undefined);
    try {
      onPicked(await mediaFrom(file));
    } catch (failure) {
      setProblem(friendlyProblem(failure));
      setBusy(false);
    }
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (chosen) void use(chosen);
  }

  /** Tira a foto do jeito que aparece na tela (o mesmo recorte da prévia; espelhada na câmera da frente). */
  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    // Mostra já que está tirando (no Android o recorte e a leitura da foto demoram um pouco).
    setBusy(true);
    setProblem(undefined);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = video.clientWidth || vw;
    const ch = video.clientHeight || vh;
    const scale = Math.max(cw / vw, ch / vh);
    const sw = Math.min(vw, cw / scale);
    const sh = Math.min(vh, ch / scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setBusy(false);
      return;
    }
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setProblem(t('Não foi possível tirar a foto. Tente de novo.'));
      setBusy(false);
      return;
    }
    await use(new File([blob], 'story.jpg', { type: 'image/jpeg' }));
  }

  return (
    <div className="storycam">
      <video ref={videoRef} className={`storycam__video${facing === 'user' ? ' storycam__video--mirror' : ''}`} autoPlay playsInline muted hidden={camera !== 'on'} />
      <input ref={galleryRef} type="file" accept="image/*,video/*" className="visually-hidden" onChange={pick} aria-label={t('Escolher foto ou vídeo')} />
      <input ref={nativeCameraRef} type="file" accept="image/*,video/*" capture="environment" className="visually-hidden" onChange={pick} aria-label={t('Abrir a câmera do aparelho')} />
      <div className="storycam__top">
        <button type="button" className="storyedit__btn" onClick={onClose} aria-label={t('Fechar')}>
          <XIcon />
        </button>
      </div>
      {camera === 'starting' ? <span className="storyview__loading" role="status" aria-label={t('Abrindo a câmera')} /> : null}
      {busy ? <span className="storyview__loading" role="status" aria-label={t('Preparando a foto')} /> : null}
      {camera === 'off' ? (
        <div className="storycam__off">
          <CameraIcon />
          <p>{t('Tire uma foto ou grave um vídeo com a câmera do aparelho, ou escolha da galeria.')}</p>
          <button type="button" className="storycam__pill" disabled={busy} onClick={() => nativeCameraRef.current?.click()}>
            <CameraIcon />
            {t('Abrir a câmera')}
          </button>
        </div>
      ) : null}
      {problem ? (
        <p className="storyedit__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="storycam__bar">
        <button type="button" className="storycam__side" disabled={busy} onClick={openGallery} aria-label={t('Escolher da galeria')}>
          <PhotoIcon />
          <span>{t('Galeria')}</span>
        </button>
        {camera === 'on' ? (
          <button type="button" className={`storycam__shutter${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => void shoot()} aria-label={t('Tirar foto')} />
        ) : (
          <span className="storycam__spacer" aria-hidden="true" />
        )}
        {camera === 'on' ? (
          <button type="button" className="storycam__side" disabled={busy} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={t('Trocar de câmera')}>
            <RefreshIcon />
            <span>{t('Virar')}</span>
          </button>
        ) : (
          <span className="storycam__spacer" aria-hidden="true" />
        )}
      </div>
      {grid && gallery ? (
        <div className="storycam__grid" role="dialog" aria-label={t('Galeria')}>
          <div className="storycam__gridtop">
            <button type="button" className="storyedit__btn" onClick={() => setGrid(false)} aria-label={t('Voltar para a câmera')}>
              <XIcon />
            </button>
          </div>
          <GalleryGrid
            gallery={gallery}
            loadingId={loadingId}
            busy={busy}
            onPick={(item) => void pickFromGrid(item)}
            onCamera={() => (camera === 'on' ? setGrid(false) : nativeCameraRef.current?.click())}
            onOther={() => galleryRef.current?.click()}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------- Editor ----------

const STYLE_LABEL: Record<StoryOverlayStyle, () => string> = {
  CLASSIC: () => t('Clássico'),
  BOX: () => t('Caixa'),
  NEON: () => t('Neon'),
  SERIF: () => t('Elegante'),
};

interface Gesture {
  index: number;
  base: StoryOverlay;
  anchor: Point[];
  moved: boolean;
  at: number;
}

function StoryEditor({ media, eventId, onBack, onCreated }: { media: StoryMedia; eventId: string; onBack: () => void; onCreated: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const box = useMediaBox(stageRef, media);
  const [items, setItems] = useState<StoryOverlay[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Texto aberto para escrever: um novo (sem `index`) ou um que já está na tela. */
  const [editing, setEditing] = useState<{ index?: number; draft: StoryOverlay } | undefined>();
  const [stickers, setStickers] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [onTrash, setOnTrash] = useState(false);
  const onTrashRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<number | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const lastLook = useRef<{ color: string; style: StoryOverlayStyle }>({ color: '#ffffff', style: 'CLASSIC' });
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | undefined>(undefined);
  const tap = useRef<{ id: number; start: Point } | undefined>(undefined);

  // Voltar: o texto aberto cuida de si; depois fecha as figurinhas; depois volta para a câmera.
  useBackStep(() => {
    if (editing) return false;
    if (busy) return true;
    if (stickers) setStickers(false);
    else onBack();
    return true;
  });

  const full = items.length >= STORY_OVERLAYS_MAX;

  function newText(at?: Point) {
    if (full) {
      setProblem(t('Use até {n} textos ou figurinhas.', { n: STORY_OVERLAYS_MAX }));
      return;
    }
    setProblem(undefined);
    setEditing({ draft: { kind: 'TEXT', text: '', x: at?.x ?? 0.5, y: at?.y ?? 0.42, scale: 1, rotation: 0, ...lastLook.current } });
  }

  function addSticker(emoji: string) {
    setStickers(false);
    if (full) {
      setProblem(t('Use até {n} textos ou figurinhas.', { n: STORY_OVERLAYS_MAX }));
      return;
    }
    setItems((list) => [...list, { kind: 'STICKER', text: emoji, x: 0.5, y: 0.45, scale: 1, rotation: 0, color: '#ffffff', style: 'CLASSIC' }]);
  }

  function finishText(draft: StoryOverlay) {
    const index = editing?.index;
    setEditing(undefined);
    lastLook.current = { color: draft.color, style: draft.style };
    const text = draft.text.trim();
    setItems((list) => {
      if (index === undefined) return text ? [...list, { ...draft, text }] : list;
      return text ? list.map((o, i) => (i === index ? { ...draft, text } : o)) : list.filter((_, i) => i !== index);
    });
  }

  // ---- Gestos: um dedo arrasta, dois dedos aumentam e giram, soltar na lixeira apaga. ----

  function point(event: ReactPointerEvent): Point {
    return { x: event.clientX, y: event.clientY };
  }

  function rebase(index: number, keep?: Gesture) {
    const base = itemsRef.current[index];
    if (!base) return;
    gesture.current = { index, base, anchor: [...pointers.current.values()].slice(0, 2), moved: keep?.moved ?? false, at: keep?.at ?? performance.now() };
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (busy) return;
    try {
      stageRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      /* ponteiro que o navegador não deixa capturar: o gesto segue sem captura */
    }
    pointers.current.set(event.pointerId, point(event));
    const g = gesture.current;
    if (g) {
      // Segundo dedo entra no gesto (em qualquer ponto da tela, como no Instagram).
      rebase(g.index, g);
      return;
    }
    const hit = (event.target as Element).closest?.('[data-ov]');
    if (hit) {
      tap.current = undefined;
      // O item tocado vem para a frente.
      const index = Number(hit.getAttribute('data-ov'));
      const list = itemsRef.current;
      const picked = list[index];
      if (!picked) return;
      const reordered = [...list.filter((_, i) => i !== index), picked];
      itemsRef.current = reordered;
      setItems(reordered);
      rebase(reordered.length - 1);
    } else if (pointers.current.size === 1) {
      tap.current = { id: event.pointerId, start: point(event) };
    }
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const now = point(event);
    pointers.current.set(event.pointerId, now);
    const g = gesture.current;
    if (!g || !box) {
      if (tap.current && Math.hypot(now.x - tap.current.start.x, now.y - tap.current.start.y) > 10) tap.current = undefined;
      return;
    }
    const pts = [...pointers.current.values()].slice(0, 2);
    let next: StoryOverlay;
    if (pts.length >= 2 && g.anchor.length >= 2) {
      const [a0, a1] = g.anchor as [Point, Point];
      const [p0, p1] = pts as [Point, Point];
      const turned = pinch([a0, a1], [p0, p1], g.base);
      const dx = (p0.x + p1.x - a0.x - a1.x) / 2;
      const dy = (p0.y + p1.y - a0.y - a1.y) / 2;
      next = { ...g.base, ...turned, x: clamp(g.base.x + dx / box.width, 0, 1), y: clamp(g.base.y + dy / box.height, 0, 1) };
      g.moved = true;
    } else {
      const a = g.anchor[0];
      const p = pts[0];
      if (!a || !p) return;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      if (!g.moved && Math.hypot(dx, dy) < 6) return;
      g.moved = true;
      next = { ...g.base, x: clamp(g.base.x + dx / box.width, 0, 1), y: clamp(g.base.y + dy / box.height, 0, 1) };
      const trash = trashRef.current?.getBoundingClientRect();
      const over = !!trash && overTrash(p, { x: trash.left + trash.width / 2, y: trash.top + trash.height / 2, radius: trash.width / 2 + 18 });
      if (over !== onTrashRef.current) {
        onTrashRef.current = over;
        setOnTrash(over);
        if (over) navigator.vibrate?.(10);
      }
    }
    setDragging(true);
    setItems((list) => list.map((o, i) => (i === g.index ? next : o)));
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g) {
      if (pointers.current.size > 0) {
        rebase(g.index, g);
        return;
      }
      gesture.current = undefined;
      const dropped = onTrashRef.current && event.type === 'pointerup';
      onTrashRef.current = false;
      setOnTrash(false);
      setDragging(false);
      if (dropped) {
        setItems((list) => list.filter((_, i) => i !== g.index));
      } else if (!g.moved && performance.now() - g.at < 400 && event.type === 'pointerup') {
        const item = itemsRef.current[g.index];
        if (item?.kind === 'TEXT') setEditing({ index: g.index, draft: item });
      }
      return;
    }
    const tapped = tap.current;
    tap.current = undefined;
    if (tapped?.id === event.pointerId && event.type === 'pointerup' && box && stageRef.current) {
      // Tocar na tela vazia começa um texto ali, como no Instagram.
      const stage = stageRef.current.getBoundingClientRect();
      newText({ x: clamp((event.clientX - stage.left - box.left) / box.width, 0.1, 0.9), y: clamp((event.clientY - stage.top - box.top) / box.height, 0.08, 0.92) });
    }
  }

  async function publish(onProfile: boolean) {
    setBusy(true);
    setProblem(undefined);
    try {
      let blob = media.blob;
      if (media.kind === 'VIDEO' && blob instanceof File) {
        setPrep(0);
        blob = await prepareVideoUpload(blob, (fraction) => setPrep(fraction), media.seconds);
        setPrep(undefined);
      }
      await api.createEventStory(eventId, blob, onProfile, items);
      onCreated();
    } catch (failure) {
      setPrep(undefined);
      setProblem(failure instanceof Error && !(failure instanceof ApiError) ? failure.message : toApiError(failure).message);
      setBusy(false);
    }
  }

  const calm = dragging || !!editing || stickers;
  return (
    <div className={`storyedit${dragging ? ' storyedit--dragging' : ''}`}>
      <div ref={stageRef} className="storyedit__stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {media.kind === 'VIDEO' ? (
          <video className="storyedit__media" src={media.url} autoPlay loop playsInline muted={muted} />
        ) : (
          <img className="storyedit__media" src={media.url} alt={t('Prévia do flash')} draggable={false} />
        )}
        {box ? (
          <div className="storyovs storyovs--edit" style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}>
            {items.map((overlay, index) => (
              <StoryOverlayItem key={index} overlay={overlay} box={box} index={index} hidden={editing?.index === index} />
            ))}
          </div>
        ) : null}
        {items.length === 0 && !calm ? <p className="storyedit__hint">{t('Toque na tela para escrever')}</p> : null}
      </div>

      <div className="storyedit__top" hidden={calm}>
        <button type="button" className="storyedit__btn" onClick={onBack} disabled={busy} aria-label={t('Descartar e voltar para a câmera')}>
          <XIcon />
        </button>
        <span className="storyedit__grow" />
        {media.kind === 'VIDEO' ? <SoundToggle muted={muted} onToggle={() => setMuted((m) => !m)} /> : null}
        <button type="button" className="storyedit__btn storyedit__btn--text" onClick={() => newText()} disabled={busy} aria-label={t('Adicionar texto')}>
          Aa
        </button>
        <button type="button" className="storyedit__btn storyedit__btn--emoji" onClick={() => setStickers(true)} disabled={busy} aria-label={t('Adicionar figurinha')}>
          <span aria-hidden="true">😊</span>
        </button>
      </div>

      <div ref={trashRef} className={`storyedit__trash${dragging ? ' is-on' : ''}${onTrash ? ' is-over' : ''}`} aria-hidden="true">
        <TrashIcon />
      </div>

      {problem ? (
        <p className="storyedit__problem" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="storyedit__bottom" hidden={calm}>
        {prep !== undefined ? (
          <div className="uploadbar storyedit__prep" role="status" aria-live="polite">
            <progress className="uploadbar__bar" max={1} value={prep} aria-label={t('Otimização do vídeo')} />
            <p className="uploadbar__text">{prepareProgressText(prep)}</p>
          </div>
        ) : null}
        <p className="storyedit__note">{t('Fica no ar por 24 h e some quando o evento acabar. No perfil, seus amigos também veem na página inicial.')}</p>
        <div className="storyedit__publish">
          <button type="button" className="storyedit__pill" disabled={busy} onClick={() => void publish(false)}>
            {t('Só no evento')}
          </button>
          <button type="button" className="storyedit__pill storyedit__pill--main" disabled={busy} onClick={() => void publish(true)}>
            {busy ? <span className="storyedit__spin" aria-hidden="true" /> : null}
            {t('Evento e perfil')}
          </button>
        </div>
      </div>

      {editing && box ? <StoryTextEditor initial={editing.draft} width={box.width} onDone={finishText} /> : null}
      {stickers ? <StoryStickerPicker onPick={addSticker} onClose={() => setStickers(false)} /> : null}
    </div>
  );
}

/** Escrever o texto: estilo no topo, cores logo acima do teclado, "Concluir" para pôr na tela. */
function StoryTextEditor({ initial, width, onDone }: { initial: StoryOverlay; width: number; onDone: (draft: StoryOverlay) => void }) {
  const [text, setText] = useState(initial.text);
  const [color, setColor] = useState(initial.color);
  const [style, setStyle] = useState<StoryOverlayStyle>(initial.style);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const keyboard = useKeyboardInset();
  const draft: StoryOverlay = { ...initial, text, color, style };
  const done = () => onDone(draft);
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A caixa cresce com o texto.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, style, width]);

  useBackStep(() => {
    doneRef.current();
    return true;
  });

  const look = overlayLook({ kind: 'TEXT', color, style, scale: 1 }, width);
  return (
    <div className="storytext" style={{ ['--kb' as string]: `${keyboard}px` }} role="dialog" aria-label={t('Escrever no flash')}>
      <button type="button" className="storytext__backdrop" onClick={done} aria-label={t('Concluir')} tabIndex={-1} />
      <div className="storytext__bar">
        <button type="button" className="storytext__style" onClick={() => setStyle((s) => nextStyle(s))} aria-label={t('Estilo do texto: {style}. Toque para trocar', { style: STYLE_LABEL[style]() })}>
          {STYLE_LABEL[style]()}
        </button>
        <button type="button" className="storytext__done" onClick={done}>
          {t('Concluir')}
        </button>
      </div>
      <div className="storytext__center">
        <textarea
          ref={inputRef}
          className={`storytext__input storyov__text storyov__text--${style.toLowerCase()}`}
          style={{ ...look, width: `${Math.round(width * TEXT_WRAP_RATIO)}px` }}
          value={text}
          maxLength={STORY_OVERLAY_TEXT_MAX}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          aria-label={t('Texto do flash')}
          placeholder={t('Escreva algo')}
          enterKeyHint="enter"
          autoCapitalize="sentences"
        />
      </div>
      <div className="storytext__palette" role="radiogroup" aria-label={t('Cor do texto')}>
        {STORY_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === color}
            className={`storytext__dot${c === color ? ' is-on' : ''}`}
            style={{ backgroundColor: c }}
            onPointerDown={(event) => event.preventDefault() /* não fecha o teclado */}
            onClick={() => setColor(c)}
            aria-label={t('Cor {color}', { color: c })}
          />
        ))}
      </div>
    </div>
  );
}

function StoryStickerPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  return (
    <div className="storystickers" role="dialog" aria-label={t('Figurinhas')}>
      <button type="button" className="storytext__backdrop" onClick={onClose} aria-label={t('Fechar')} tabIndex={-1} />
      <div className="storystickers__panel">
        <div className="storystickers__head">
          <strong>{t('Figurinhas')}</strong>
          <button type="button" className="storyedit__btn" onClick={onClose} aria-label={t('Fechar')}>
            <XIcon />
          </button>
        </div>
        <div className="storystickers__grid">
          {STORY_STICKERS.map((emoji) => (
            <button key={emoji} type="button" className="storystickers__btn" onClick={() => onPick(emoji)} aria-label={t('Adicionar {emoji}', { emoji })}>
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
