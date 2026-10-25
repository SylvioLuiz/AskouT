import { t } from '../lib/i18n/index.ts';
/** Recorte em frações da imagem (0 a 1): canto de cima à esquerda e tamanho. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropMode = 'square' | 'portrait' | 'landscape' | 'free';
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Os formatos que o Instagram usa, mais o recorte livre. `ratio` é largura ÷ altura. */
export const CROP_MODES: readonly { id: CropMode; label: string; ratio: number | null }[] = [
  { id: 'square', label: '1:1', ratio: 1 },
  { id: 'portrait', label: '4:5', ratio: 4 / 5 },
  { id: 'landscape', label: '1,91:1', ratio: 1.91 },
  { id: 'free', label: t('Livre'), ratio: null },
];

/** Menor lado do recorte, como fração do lado menor da imagem. */
export const CROP_MIN = 0.1;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function ratioOf(mode: CropMode): number | null {
  return CROP_MODES.find((m) => m.id === mode)?.ratio ?? null;
}

/** Maior recorte com a proporção pedida que cabe na imagem, centrado em (cx, cy) o quanto der. */
export function fitRatio(imgW: number, imgH: number, ratio: number, cx = 0.5, cy = 0.5): CropRect {
  const pw = Math.min(imgW, imgH * ratio);
  const ph = pw / ratio;
  const w = pw / imgW;
  const h = ph / imgH;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Recorte inicial de um formato: o maior possível, no meio. Livre começa com a imagem toda. */
export function initialCrop(imgW: number, imgH: number, mode: CropMode): CropRect {
  const ratio = ratioOf(mode);
  return ratio === null ? { x: 0, y: 0, w: 1, h: 1 } : fitRatio(imgW, imgH, ratio);
}

/** Troca de formato: mantém o centro do recorte atual. Livre mantém o recorte como está. */
export function changeMode(rect: CropRect, imgW: number, imgH: number, mode: CropMode): CropRect {
  const ratio = ratioOf(mode);
  return ratio === null ? rect : fitRatio(imgW, imgH, ratio, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

/** Arrasta o recorte sem sair da imagem. */
export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.w), y: clamp(rect.y + dy, 0, 1 - rect.h) };
}

/**
 * Puxa um canto até o ponto (px, py), em frações da imagem. O canto oposto fica parado.
 * Com `ratio`, a proporção é mantida; sem ele (livre), cada lado muda sozinho.
 */
export function resizeCrop(rect: CropRect, corner: Corner, px: number, py: number, imgW: number, imgH: number, ratio: number | null): CropRect {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const ax = west ? rect.x + rect.w : rect.x;
  const ay = north ? rect.y + rect.h : rect.y;
  const sx = west ? -1 : 1;
  const sy = north ? -1 : 1;
  const cx = clamp(px, 0, 1);
  const cy = clamp(py, 0, 1);
  const roomX = sx < 0 ? ax : 1 - ax;
  const roomY = sy < 0 ? ay : 1 - ay;

  if (ratio === null) {
    const w = clamp(Math.abs(cx - ax), Math.min(CROP_MIN, roomX), roomX);
    const h = clamp(Math.abs(cy - ay), Math.min(CROP_MIN, roomY), roomY);
    return { x: sx < 0 ? ax - w : ax, y: sy < 0 ? ay - h : ay, w, h };
  }

  // Em pixels: a largura é a maior entre o que o dedo pede na horizontal e na vertical.
  let pw = Math.max(Math.abs(cx - ax) * imgW, Math.abs(cy - ay) * imgH * ratio);
  pw = Math.min(pw, roomX * imgW, roomY * imgH * ratio);
  pw = Math.max(pw, Math.min(CROP_MIN * Math.min(imgW, imgH * ratio), roomX * imgW, roomY * imgH * ratio));
  const w = pw / imgW;
  const h = pw / ratio / imgH;
  return { x: sx < 0 ? ax - w : ax, y: sy < 0 ? ay - h : ay, w, h };
}

/** Região em pixels da imagem original. */
export function cropToPixels(rect: CropRect, imgW: number, imgH: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.min(imgW - 1, Math.round(clamp(rect.x, 0, 1) * imgW));
  const sy = Math.min(imgH - 1, Math.round(clamp(rect.y, 0, 1) * imgH));
  const sw = Math.max(1, Math.min(imgW - sx, Math.round(rect.w * imgW)));
  const sh = Math.max(1, Math.min(imgH - sy, Math.round(rect.h * imgH)));
  return { sx, sy, sw, sh };
}

/** Proporção (largura ÷ altura) que o feed mostra: a da primeira foto, entre 4:5 e 1,91:1 como no Instagram. */
export function feedRatio(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 4 / 5;
  return clamp(width / height, 4 / 5, 1.91);
}
