/**
 * Edição de foto antes de enviar no chat: girar, recortar, desenhar e escrever.
 * Tudo aqui é conta pura (frações da imagem), para testar sem navegador.
 */

export interface EditPoint {
  x: number;
  y: number;
}

/** Traço do pincel. `size` é a espessura como fração do lado menor da imagem. */
export interface EditStroke {
  color: string;
  size: number;
  points: EditPoint[];
}

/** Texto solto na foto. (x, y) é o centro; `size` é a altura da letra como fração do lado menor da imagem. */
export interface EditText {
  id: string;
  text: string;
  color: string;
  /** Com fundo: caixa na cor escolhida e letra em contraste. */
  boxed: boolean;
  x: number;
  y: number;
  size: number;
}

export interface EditLayers {
  strokes: EditStroke[];
  texts: EditText[];
}

/** Recorte em frações da imagem, como o de `crop.ts`. */
export interface EditRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Maior lado da foto editada; o envio ainda reduz o que passar do limite do chat. */
export const EDIT_MAX_SIDE = 2560;
/** Espessuras do pincel (fração do lado menor). */
export const BRUSH_SIZES = [0.008, 0.016, 0.03] as const;
export const TEXT_SIZE_DEFAULT = 0.075;
export const TEXT_SIZE_MIN = 0.04;
export const TEXT_SIZE_MAX = 0.2;
export const EDIT_TEXT_MAX = 120;
/** Altura da linha do texto, em relação ao tamanho da letra. */
export const TEXT_LINE = 1.25;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Tamanho final cabendo em `max` no maior lado, sem aumentar. */
export function fitSize(width: number, height: number, max = EDIT_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Um ponto depois de girar a foto 90° no sentido horário. */
export function rotatePoint(p: EditPoint): EditPoint {
  return { x: 1 - p.y, y: p.x };
}

/** Desenhos e textos acompanham a foto girada; o texto continua em pé. Tamanhos usam o lado menor, que não muda. */
export function rotateLayers(layers: EditLayers): EditLayers {
  return {
    strokes: layers.strokes.map((s) => ({ ...s, points: s.points.map(rotatePoint) })),
    texts: layers.texts.map((tx) => ({ ...tx, ...rotatePoint(tx) })),
  };
}

/**
 * Desenhos e textos depois do recorte `rect` numa foto de `width` × `height`.
 * Traços saem do quadro naturalmente; o texto fica dentro do quadro para não sumir.
 */
export function cropLayers(layers: EditLayers, rect: EditRect, width: number, height: number): EditLayers {
  const before = Math.min(width, height);
  const after = Math.min(rect.w * width, rect.h * height);
  const k = after > 0 ? before / after : 1;
  const move = (p: EditPoint): EditPoint => ({ x: (p.x - rect.x) / rect.w, y: (p.y - rect.y) / rect.h });
  return {
    strokes: layers.strokes.map((s) => ({ ...s, size: s.size * k, points: s.points.map(move) })),
    texts: layers.texts.map((tx) => {
      const p = move(tx);
      return { ...tx, x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), size: clamp(tx.size * k, TEXT_SIZE_MIN, TEXT_SIZE_MAX) };
    }),
  };
}

/** Recorte que não faz nada (a foto toda). */
export function isWholeImage(rect: EditRect): boolean {
  const eps = 0.002;
  return rect.x <= eps && rect.y <= eps && rect.w >= 1 - eps && rect.h >= 1 - eps;
}

/** Cor da letra sobre uma caixa colorida: preta nas cores claras, branca nas escuras. */
export function contrastInk(hex: string): '#111111' | '#ffffff' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return '#ffffff';
  const n = Number.parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? '#111111' : '#ffffff';
}

/** Linhas do texto, sem as vazias das pontas. */
export function textLines(text: string): string[] {
  return text.replace(/\r/g, '').trim().split('\n');
}

/** Ponto do pincel novo só se andou o bastante (evita milhares de pontos parados). */
export function farEnough(last: EditPoint | undefined, next: EditPoint, minStep: number): boolean {
  return !last || Math.hypot(next.x - last.x, next.y - last.y) >= minStep;
}

/** Nome do arquivo editado, com a extensão do formato novo. */
export function editedName(original: string, type: 'image/jpeg' | 'image/png'): string {
  const base = original.replace(/\.[^./\\]+$/, '') || 'foto';
  return `${base}-editada.${type === 'image/png' ? 'png' : 'jpg'}`;
}

/** Formato da foto editada: PNG continua PNG (pode ter transparência), o resto vira JPEG. */
export function editedType(original: string): 'image/jpeg' | 'image/png' {
  return original === 'image/png' ? 'image/png' : 'image/jpeg';
}

/** Fotos que dá para editar: não vale para GIF (perderia a animação) nem para vídeo. */
export function canEditImage(type: string): boolean {
  return type.startsWith('image/') && type !== 'image/gif';
}
