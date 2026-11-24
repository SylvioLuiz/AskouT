import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CropEditor } from './crop.tsx';
import { BrushIcon, CropFrameIcon, RotateIcon, UndoIcon, XIcon } from './icons.tsx';
import { useBackStep } from '../lib/use-back-step.ts';
import { useKeyboardInset, useMediaBox } from './story-overlays.tsx';
import {
  BRUSH_SIZES,
  contrastInk,
  cropLayers,
  EDIT_TEXT_MAX,
  editedName,
  editedType,
  farEnough,
  fitSize,
  isWholeImage,
  rotateLayers,
  TEXT_LINE,
  TEXT_SIZE_DEFAULT,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  textLines,
} from '../lib/image-edit.ts';
import type { EditLayers, EditPoint, EditRect, EditStroke, EditText } from '../lib/image-edit.ts';
import { STORY_COLORS } from '../lib/story-overlays.ts';
import { t } from '../lib/i18n/index.ts';

interface Base {
  url: string;
  img: HTMLImageElement;
  width: number;
  height: number;
}

interface Snapshot {
  base: Base;
  layers: EditLayers;
}

type Mode = 'view' | 'draw' | 'crop';

const EMPTY: EditLayers = { strokes: [], texts: [] };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('Não foi possível abrir a foto.')));
    img.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('Não foi possível salvar a foto.')))), type, 0.92));
}

function fontFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'sans-serif';
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: EditStroke[], w: number, h: number) {
  const side = Math.min(w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const first = s.points[0];
    if (!first) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.size * side);
    ctx.beginPath();
    ctx.moveTo(first.x * w, first.y * h);
    if (s.points.length === 1) ctx.lineTo(first.x * w + 0.01, first.y * h);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x * w, p.y * h);
    ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Mesmo desenho do texto na tela (ver `.imgedit__text`): letra 700, linha 1,25, caixa com 0,2em × 0,4em de folga. */
function drawTexts(ctx: CanvasRenderingContext2D, texts: EditText[], w: number, h: number) {
  const side = Math.min(w, h);
  const family = fontFamily();
  for (const tx of texts) {
    const size = tx.size * side;
    const lines = textLines(tx.text);
    const lineH = size * TEXT_LINE;
    ctx.font = `700 ${size}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = tx.x * w;
    const cy = tx.y * h;
    const top = cy - (lines.length * lineH) / 2;
    if (tx.boxed) {
      const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const padX = size * 0.4;
      const padY = size * 0.2;
      ctx.fillStyle = tx.color;
      roundRect(ctx, cx - width / 2 - padX, top - padY, width + padX * 2, lines.length * lineH + padY * 2, size * 0.3);
      ctx.fill();
      ctx.fillStyle = contrastInk(tx.color);
    } else {
      ctx.fillStyle = tx.color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = size * 0.15;
      ctx.shadowOffsetY = size * 0.03;
    }
    lines.forEach((line, i) => ctx.fillText(line, cx, top + lineH * (i + 0.5)));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
}

/** Foto com desenhos e textos numa tela só, até `EDIT_MAX_SIDE` no maior lado. */
async function flatten(base: Base, layers: EditLayers, type: string): Promise<HTMLCanvasElement> {
  if (document.fonts) await document.fonts.ready.catch(() => undefined);
  const { width, height } = fitSize(base.width, base.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Não foi possível editar a foto neste aparelho.'));
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(base.img, 0, 0, width, height);
  drawStrokes(ctx, layers.strokes, width, height);
  drawTexts(ctx, layers.texts, width, height);
  return canvas;
}

/** Nova foto de base, girada 90° no sentido horário ou recortada. */
async function transformBase(base: Base, op: { rotate: true } | { crop: EditRect }): Promise<Base> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t('Não foi possível editar a foto neste aparelho.'));
  if ('rotate' in op) {
    const { width, height } = fitSize(base.height, base.width);
    canvas.width = width;
    canvas.height = height;
    ctx.translate(width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(base.img, 0, 0, height, width);
  } else {
    const r = op.crop;
    const sw = r.w * base.width;
    const sh = r.h * base.height;
    const { width, height } = fitSize(sw, sh);
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(base.img, r.x * base.width, r.y * base.height, sw, sh, 0, 0, width, height);
  }
  const blob = await canvasBlob(canvas, 'image/png');
  const url = URL.createObjectURL(blob);
  const img = await loadImage(url);
  return { url, img, width: img.naturalWidth, height: img.naturalHeight };
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Editar a foto antes de mandar no chat, como no WhatsApp: girar, recortar, desenhar e escrever.
 * Devolve um arquivo novo (ou o mesmo, se nada mudou).
 */
export function ImageEditor({ file, onDone, onCancel }: { file: File; onDone: (file: File) => void; onCancel: () => void }) {
  const [base, setBase] = useState<Base | undefined>();
  const [layers, setLayers] = useState<EditLayers>(EMPTY);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [mode, setMode] = useState<Mode>('view');
  const [color, setColor] = useState<string>(STORY_COLORS[2]);
  const [brush, setBrush] = useState(1);
  const [editing, setEditing] = useState<{ index?: number; draft: EditText } | undefined>();
  const [cropSource, setCropSource] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const urls = useRef<string[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ id: number; points: EditPoint[] } | undefined>(undefined);
  const drag = useRef<{ id: number; index: number; start: EditPoint; from: EditPoint; before: Snapshot; moved: boolean } | undefined>(undefined);
  const box = useMediaBox(stageRef, base ? { width: base.width, height: base.height } : undefined);

  // Abre a foto escolhida e solta as cópias quando o editor fecha.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    let alive = true;
    loadImage(url)
      .then((img) => alive && setBase({ url, img, width: img.naturalWidth, height: img.naturalHeight }))
      .catch((failure: Error) => alive && setProblem(failure.message));
    return () => {
      alive = false;
    };
  }, [file]);
  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    },
    [],
  );

  // Redesenha os traços quando mudam ou quando a tela muda de tamanho.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    drawStrokes(ctx, layers.strokes, box.width, box.height);
  }, [layers.strokes, box?.width, box?.height]);

  useBackStep(() => {
    if (editing) return false;
    if (busy) return true;
    if (mode === 'crop') closeCrop();
    else if (mode === 'draw') setMode('view');
    else onCancel();
    return true;
  });

  function remember() {
    if (base) setHistory((h) => [...h, { base, layers }]);
  }

  function undo() {
    const last = history[history.length - 1];
    if (!last || busy) return;
    setHistory((h) => h.slice(0, -1));
    setBase(last.base);
    setLayers(last.layers);
  }

  function track(next: Base) {
    urls.current.push(next.url);
    return next;
  }

  async function rotate() {
    if (!base || busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const next = track(await transformBase(base, { rotate: true }));
      remember();
      setBase(next);
      setLayers((l) => rotateLayers(l));
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : t('Não foi possível girar a foto.'));
    } finally {
      setBusy(false);
    }
  }

  async function openCrop() {
    if (!base || busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      // O recorte mostra a foto já com desenhos e textos, para a pessoa ver o que fica.
      const canvas = await flatten(base, layers, 'image/png');
      const url = URL.createObjectURL(await canvasBlob(canvas, 'image/png'));
      urls.current.push(url);
      setCropSource(url);
      setMode('crop');
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : t('Não foi possível recortar a foto.'));
    } finally {
      setBusy(false);
    }
  }

  function closeCrop() {
    setMode('view');
    setCropSource(undefined);
  }

  async function applyCrop(rect: EditRect) {
    if (!base) return;
    if (isWholeImage(rect)) {
      closeCrop();
      return;
    }
    setBusy(true);
    try {
      const next = track(await transformBase(base, { crop: rect }));
      remember();
      setBase(next);
      setLayers((l) => cropLayers(l, rect, base.width, base.height));
      closeCrop();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : t('Não foi possível recortar a foto.'));
      closeCrop();
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!base || busy) return;
    if (history.length === 0) {
      onDone(file);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      const type = editedType(file.type);
      const canvas = await flatten(base, layers, type);
      const blob = await canvasBlob(canvas, type);
      onDone(new File([blob], editedName(file.name, type), { type, lastModified: Date.now() }));
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : t('Não foi possível salvar a foto.'));
      setBusy(false);
    }
  }

  // ---- Texto ----

  function newText() {
    if (!box) return;
    setProblem(undefined);
    setEditing({ draft: { id: newId(), text: '', color: '#ffffff', boxed: false, x: 0.5, y: 0.5, size: TEXT_SIZE_DEFAULT } });
  }

  function finishText(draft: EditText) {
    const index = editing?.index;
    setEditing(undefined);
    const text = draft.text.trim();
    const current = index === undefined ? undefined : layers.texts[index];
    if (index === undefined && !text) return;
    if (current && current.text === text && current.color === draft.color && current.boxed === draft.boxed && current.size === draft.size) return;
    remember();
    setLayers((l) => {
      if (index === undefined) return { ...l, texts: [...l.texts, { ...draft, text }] };
      return { ...l, texts: text ? l.texts.map((x, i) => (i === index ? { ...draft, text } : x)) : l.texts.filter((_, i) => i !== index) };
    });
  }

  // ---- Gestos ----

  function relative(event: ReactPointerEvent): EditPoint {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  }

  function capture(event: ReactPointerEvent<HTMLElement>) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* sem captura, o gesto segue mesmo assim */
    }
  }

  function drawDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== 'draw' || stroke.current || busy) return;
    event.preventDefault();
    capture(event);
    const p = relative(event);
    stroke.current = { id: event.pointerId, points: [p] };
    paintSegment(p, p);
  }

  function paintSegment(from: EditPoint, to: EditPoint) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !box) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, (BRUSH_SIZES[brush] ?? BRUSH_SIZES[1]) * Math.min(box.width, box.height));
    ctx.beginPath();
    ctx.moveTo(from.x * box.width, from.y * box.height);
    ctx.lineTo(to.x * box.width + (from === to ? 0.01 : 0), to.y * box.height);
    ctx.stroke();
  }

  function drawMove(event: ReactPointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (!s || s.id !== event.pointerId || !box) return;
    const p = relative(event);
    const last = s.points[s.points.length - 1];
    if (!farEnough(last, p, 1.5 / Math.max(box.width, box.height))) return;
    s.points.push(p);
    if (last) paintSegment(last, p);
  }

  function drawUp(event: ReactPointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (!s || s.id !== event.pointerId) return;
    stroke.current = undefined;
    remember();
    const done: EditStroke = { color, size: BRUSH_SIZES[brush] ?? BRUSH_SIZES[1], points: s.points };
    setLayers((l) => ({ ...l, strokes: [...l.strokes, done] }));
  }

  function textDown(index: number) {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      if (mode !== 'view' || busy || !base) return;
      event.preventDefault();
      event.stopPropagation();
      capture(event);
      const item = layers.texts[index];
      if (!item) return;
      drag.current = { id: event.pointerId, index, start: relative(event), from: { x: item.x, y: item.y }, before: { base, layers }, moved: false };
    };
  }

  function textMove(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId || !box) return;
    const p = relative(event);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx * box.width, dy * box.height) < 6) return;
    d.moved = true;
    const x = Math.min(1, Math.max(0, d.from.x + dx));
    const y = Math.min(1, Math.max(0, d.from.y + dy));
    setLayers((l) => ({ ...l, texts: l.texts.map((tx, i) => (i === d.index ? { ...tx, x, y } : tx)) }));
  }

  function textUp(event: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = undefined;
    if (d.moved) {
      setHistory((h) => [...h, d.before]);
      return;
    }
    // Toque sem arrastar: abre o texto para mudar.
    const item = layers.texts[d.index];
    if (item) setEditing({ index: d.index, draft: item });
  }

  const side = box ? Math.min(box.width, box.height) : 0;
  const editingIndex = editing?.index;

  return createPortal(
    <div className="storycreate imgedit" role="dialog" aria-modal="true" aria-label={t('Editar foto')}>
      <div className="storyedit">
        <div ref={stageRef} className="storyedit__stage">
          {base ? <img className="storyedit__media" src={base.url} alt={t('Foto para editar')} draggable={false} /> : null}
          {box ? (
            <div
              className={`imgedit__layer${mode === 'draw' ? ' imgedit__layer--draw' : ''}`}
              style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}
              onPointerDown={drawDown}
              onPointerMove={drawMove}
              onPointerUp={drawUp}
              onPointerCancel={drawUp}
            >
              <canvas ref={canvasRef} className="imgedit__canvas" />
              {layers.texts.map((tx, i) => (
                <div
                  key={tx.id}
                  className={`imgedit__text${tx.boxed ? ' imgedit__text--boxed' : ''}`}
                  style={textStyle(tx, side, { left: `${tx.x * box.width}px`, top: `${tx.y * box.height}px`, visibility: editingIndex === i ? 'hidden' : undefined })}
                  role="button"
                  tabIndex={mode === 'view' ? 0 : -1}
                  aria-label={t('Texto: {text}. Toque para mudar ou arraste', { text: tx.text })}
                  onPointerDown={textDown(i)}
                  onPointerMove={textMove}
                  onPointerUp={textUp}
                  onPointerCancel={textUp}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setEditing({ index: i, draft: tx });
                  }}
                >
                  {textLines(tx.text).join('\n')}
                </div>
              ))}
            </div>
          ) : null}
          {!base && !problem ? <p className="storyedit__hint">{t('Abrindo a foto…')}</p> : null}
        </div>

        {mode === 'draw' ? (
          <div className="storyedit__top">
            <button type="button" className="storytext__done" onClick={() => setMode('view')}>
              {t('Concluir')}
            </button>
            <span className="storyedit__grow" />
            <button type="button" className="storyedit__btn" onClick={undo} disabled={history.length === 0 || busy} aria-label={t('Desfazer')}>
              <UndoIcon />
            </button>
          </div>
        ) : (
          <div className="storyedit__top">
            <button type="button" className="storyedit__btn" onClick={onCancel} disabled={busy} aria-label={t('Cancelar edição')}>
              <XIcon />
            </button>
            <span className="storyedit__grow" />
            {history.length > 0 ? (
              <button type="button" className="storyedit__btn" onClick={undo} disabled={busy} aria-label={t('Desfazer')}>
                <UndoIcon />
              </button>
            ) : null}
            <button type="button" className="storyedit__btn" onClick={() => void rotate()} disabled={!base || busy} aria-label={t('Girar')}>
              <RotateIcon />
            </button>
            <button type="button" className="storyedit__btn" onClick={() => void openCrop()} disabled={!base || busy} aria-label={t('Recortar')}>
              <CropFrameIcon />
            </button>
            <button type="button" className="storyedit__btn" onClick={() => setMode('draw')} disabled={!base || busy} aria-label={t('Desenhar')}>
              <BrushIcon />
            </button>
            <button type="button" className="storyedit__btn storyedit__btn--text" onClick={newText} disabled={!base || busy} aria-label={t('Adicionar texto')}>
              Aa
            </button>
          </div>
        )}

        {problem ? (
          <p className="storyedit__problem" role="alert">
            {problem}
          </p>
        ) : null}

        {mode === 'draw' ? (
          <div className="storyedit__bottom imgedit__tools">
            <div className="imgedit__sizes" role="radiogroup" aria-label={t('Espessura do pincel')}>
              {BRUSH_SIZES.map((size, i) => (
                <button key={size} type="button" role="radio" aria-checked={brush === i} className={`imgedit__size${brush === i ? ' is-on' : ''}`} onClick={() => setBrush(i)} aria-label={[t('Fino'), t('Médio'), t('Grosso')][i]}>
                  <span style={{ width: `${8 + i * 7}px`, height: `${8 + i * 7}px`, backgroundColor: color }} />
                </button>
              ))}
            </div>
            <Palette value={color} onPick={setColor} label={t('Cor do pincel')} />
          </div>
        ) : (
          <div className="storyedit__bottom">
            <button type="button" className="storyedit__pill storyedit__pill--main" disabled={!base || busy} onClick={() => void finish()}>
              {busy ? <span className="storyedit__spin" aria-hidden="true" /> : null}
              {t('Pronto')}
            </button>
          </div>
        )}
      </div>

      {editing && box ? <TextEditor initial={editing.draft} side={side} width={box.width} onDone={finishText} /> : null}

      {mode === 'crop' && cropSource ? (
        <div className="imgedit__crop">
          <CropEditor source={cropSource} initial={{ x: 0, y: 0, w: 1, h: 1 }} busy={busy} onApply={(rect) => void applyCrop(rect)} onCancel={closeCrop} />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function textStyle(tx: Pick<EditText, 'color' | 'boxed' | 'size'>, side: number, extra: CSSProperties = {}): CSSProperties {
  return {
    ...extra,
    fontSize: `${tx.size * side}px`,
    color: tx.boxed ? contrastInk(tx.color) : tx.color,
    backgroundColor: tx.boxed ? tx.color : undefined,
  };
}

function Palette({ value, onPick, label }: { value: string; onPick: (color: string) => void; label: string }) {
  return (
    <div className="imgedit__palette" role="radiogroup" aria-label={label}>
      {STORY_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          className={`storytext__dot${c === value ? ' is-on' : ''}`}
          style={{ backgroundColor: c }}
          onPointerDown={(event) => event.preventDefault() /* não fecha o teclado */}
          onClick={() => onPick(c)}
          aria-label={t('Cor {color}', { color: c })}
        />
      ))}
    </div>
  );
}

/** Escrever ou mudar um texto: cor, com ou sem fundo, e tamanho. Texto vazio apaga. */
function TextEditor({ initial, side, width, onDone }: { initial: EditText; side: number; width: number; onDone: (draft: EditText) => void }) {
  const [text, setText] = useState(initial.text);
  const [color, setColor] = useState(initial.color);
  const [boxed, setBoxed] = useState(initial.boxed);
  const [size, setSize] = useState(initial.size);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const keyboard = useKeyboardInset();
  const draft: EditText = { ...initial, text, color, boxed, size };
  const doneRef = useRef(() => onDone(draft));
  doneRef.current = () => onDone(draft);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text, size, boxed]);

  useBackStep(() => {
    doneRef.current();
    return true;
  });

  return (
    <div className="storytext imgedit__write" style={{ ['--kb' as string]: `${keyboard}px` }} role="dialog" aria-label={t('Escrever na foto')}>
      <button type="button" className="storytext__backdrop" onClick={() => doneRef.current()} aria-label={t('Concluir')} tabIndex={-1} />
      <div className="storytext__bar">
        <button type="button" className="storytext__style" aria-pressed={boxed} onPointerDown={(event) => event.preventDefault()} onClick={() => setBoxed((b) => !b)}>
          {boxed ? t('Com fundo') : t('Sem fundo')}
        </button>
        <button type="button" className="storytext__done" onClick={() => doneRef.current()}>
          {t('Concluir')}
        </button>
      </div>
      <div className="storytext__center">
        <textarea
          ref={inputRef}
          className={`storytext__input imgedit__text imgedit__text--input${boxed ? ' imgedit__text--boxed' : ''}`}
          style={{ ...textStyle({ color, boxed, size }, side), maxWidth: `${Math.round(width * 0.9)}px`, width: `${Math.round(width * 0.9)}px` }}
          value={text}
          maxLength={EDIT_TEXT_MAX}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          aria-label={t('Texto na foto')}
          placeholder={t('Escreva algo')}
          enterKeyHint="enter"
          autoCapitalize="sentences"
        />
      </div>
      <div className="imgedit__writebar">
        <label className="imgedit__range">
          <span className="visually-hidden">{t('Tamanho do texto')}</span>
          <span aria-hidden="true">A</span>
          <input type="range" min={TEXT_SIZE_MIN} max={TEXT_SIZE_MAX} step={0.005} value={size} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setSize(Number(event.target.value))} />
          <span aria-hidden="true" className="imgedit__range-big">
            A
          </span>
        </label>
        <Palette value={color} onPick={setColor} label={t('Cor do texto')} />
      </div>
    </div>
  );
}
