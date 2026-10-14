import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Button } from './ui.tsx';
import { changeMode, CROP_MODES, initialCrop, moveCrop, ratioOf, resizeCrop } from '../lib/crop.ts';
import type { Corner, CropMode, CropRect } from '../lib/crop.ts';

type Drag = { kind: 'move' | Corner; startX: number; startY: number; rect: CropRect };

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const CORNER_LABEL: Record<Corner, string> = { nw: 'canto de cima à esquerda', ne: 'canto de cima à direita', sw: 'canto de baixo à esquerda', se: 'canto de baixo à direita' };

/**
 * Recorte da foto: escolha um formato do Instagram (1:1, 4:5, 1,91:1) ou Livre,
 * arraste a moldura e puxe os cantos para mudar o tamanho.
 */
export function CropEditor({ source, initial, busy, onApply, onCancel }: { source: string; initial?: CropRect | undefined; busy: boolean; onApply: (rect: CropRect) => void; onCancel: () => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | undefined>();
  const [mode, setMode] = useState<CropMode>(initial ? 'free' : 'portrait');
  const [rect, setRect] = useState<CropRect | undefined>(initial);
  const drag = useRef<Drag | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setSize({ w: img.naturalWidth, h: img.naturalHeight });
      setRect((current) => current ?? initialCrop(img.naturalWidth, img.naturalHeight, 'portrait'));
    };
    img.src = source;
  }, [source]);

  if (!size || !rect) return <p className="muted">Abrindo a foto…</p>;
  const { w: imgW, h: imgH } = size;
  const ratio = imgW / imgH;

  function pick(next: CropMode) {
    setMode(next);
    setRect((current) => (current ? changeMode(current, imgW, imgH, next) : initialCrop(imgW, imgH, next)));
  }

  function point(event: PointerEvent): { x: number; y: number } {
    const bounds = box.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return { x: 0, y: 0 };
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  }

  function start(kind: Drag['kind']) {
    return (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const p = point(event);
      drag.current = { kind, startX: p.x, startY: p.y, rect: rect as CropRect };
    };
  }

  function onMove(event: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = point(event);
    if (d.kind === 'move') setRect(moveCrop(d.rect, p.x - d.startX, p.y - d.startY));
    else setRect(resizeCrop(d.rect, d.kind, p.x, p.y, imgW, imgH, ratioOf(mode)));
  }

  function end() {
    drag.current = undefined;
  }

  return (
    <div className="cropper">
      <div className="cropper__modes" role="group" aria-label="Formato do recorte">
        {CROP_MODES.map((m) => (
          <button key={m.id} type="button" className={`cropper__mode${mode === m.id ? ' cropper__mode--on' : ''}`} aria-pressed={mode === m.id} onClick={() => pick(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="cropper__frame" ref={box} style={{ aspectRatio: String(ratio), width: `min(100%, ${(60 * ratio).toFixed(2)}vh)` }}>
        <img src={source} alt="Foto para recortar" draggable={false} />
        <div
          className="cropper__box"
          role="group"
          aria-label="Área do recorte"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
          onPointerDown={start('move')}
          onPointerMove={onMove}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {CORNERS.map((corner) => (
            <span key={corner} className={`cropper__handle cropper__handle--${corner}`} role="presentation" aria-label={CORNER_LABEL[corner]} onPointerDown={start(corner)} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} />
          ))}
        </div>
      </div>
      <p className="muted cropper__hint">Arraste a moldura e puxe os cantos para ajustar.</p>
      <div className="row-actions">
        <Button variant="secondary" small onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button small loading={busy} onClick={() => onApply(rect)}>
          Aplicar recorte
        </Button>
      </div>
    </div>
  );
}
