import type { CropRect } from './crop.ts';

/**
 * Recorte da foto de perfil como no Instagram, TikTok e Facebook: um círculo fixo no meio
 * e a foto se mexe por baixo (arrasta para mover, pinça ou rodinha para dar zoom).
 *
 * `zoom` 1 = a foto cobre o círculo inteiro pelo lado menor. `x`/`y` = quanto o centro da foto
 * está deslocado do centro do quadro, em pixels da tela. A foto nunca deixa buraco no círculo.
 */
export interface AvatarView {
  zoom: number;
  x: number;
  y: number;
}

export const AVATAR_ZOOM_MAX = 5;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Tamanho da foto na tela, em pixels, para um quadro de lado `frame`. */
export function shownSize(view: AvatarView, frame: number, imgW: number, imgH: number): { w: number; h: number } {
  const base = frame / Math.max(1, Math.min(imgW, imgH));
  return { w: imgW * base * view.zoom, h: imgH * base * view.zoom };
}

/** Zoom entre 1 e o máximo e deslocamento que não deixa a borda da foto entrar no quadro. */
export function clampView(view: AvatarView, frame: number, imgW: number, imgH: number): AvatarView {
  const zoom = clamp(Number.isFinite(view.zoom) ? view.zoom : 1, 1, AVATAR_ZOOM_MAX);
  const { w, h } = shownSize({ zoom, x: 0, y: 0 }, frame, imgW, imgH);
  const roomX = Math.max(0, (w - frame) / 2);
  const roomY = Math.max(0, (h - frame) / 2);
  return { zoom, x: clamp(view.x, -roomX, roomX), y: clamp(view.y, -roomY, roomY) };
}

/** Começa centrado e sem zoom, como os apps fazem. */
export const initialAvatarView = (): AvatarView => ({ zoom: 1, x: 0, y: 0 });

/** Arrasta a foto (dx/dy em pixels da tela). */
export function panView(view: AvatarView, dx: number, dy: number, frame: number, imgW: number, imgH: number): AvatarView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, frame, imgW, imgH);
}

/**
 * Zoom mantendo parado o ponto sob os dedos/cursor. (px, py) é relativo ao centro do quadro.
 * Sem ponto, o zoom é no centro (botões e slider).
 */
export function zoomView(view: AvatarView, nextZoom: number, frame: number, imgW: number, imgH: number, px = 0, py = 0): AvatarView {
  const zoom = clamp(nextZoom, 1, AVATAR_ZOOM_MAX);
  const k = zoom / view.zoom;
  return clampView({ zoom, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, frame, imgW, imgH);
}

/** O quadrado que aparece dentro do círculo, em frações da foto original (para recortar em pixels). */
export function viewToCrop(view: AvatarView, frame: number, imgW: number, imgH: number): CropRect {
  const v = clampView(view, frame, imgW, imgH);
  const { w, h } = shownSize(v, frame, imgW, imgH);
  const left = (w - frame) / 2 - v.x;
  const top = (h - frame) / 2 - v.y;
  return { x: left / w, y: top / h, w: frame / w, h: frame / h };
}
