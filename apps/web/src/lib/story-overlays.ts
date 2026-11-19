/**
 * Textos e figurinhas por cima do story, como no Instagram.
 *
 * Por que guardar à parte (e não "queimar" na imagem): vale igual para foto e vídeo (queimar em vídeo
 * exigiria recodificar no aparelho), o texto continua nítido em qualquer tela, o leitor de tela lê,
 * e a mídia enviada é a original. Quem assiste desenha por cima com as mesmas regras do editor.
 *
 * Posição (`x`, `y`): centro do item, de 0 a 1 dentro da área onde a mídia aparece (encaixada inteira,
 * como no visualizador). O tamanho é proporcional à largura dessa área, então fica igual em qualquer tela.
 */
import type { StoryOverlay, StoryOverlayStyle } from './types.ts';

export const STORY_OVERLAYS_MAX = 12;
export const STORY_OVERLAY_TEXT_MAX = 160;
export const SCALE_MIN = 0.3;
export const SCALE_MAX = 5;

/** Tamanho base da letra: fração da largura da mídia (multiplicado por `scale`). */
export const TEXT_FONT_RATIO = 0.075;
export const STICKER_FONT_RATIO = 0.16;
/** Largura máxima de uma linha de texto: fração da largura da mídia. */
export const TEXT_WRAP_RATIO = 0.9;

export const STORY_STYLES: readonly StoryOverlayStyle[] = ['CLASSIC', 'BOX', 'NEON', 'SERIF'];

/** Paleta do editor (como a fileira de bolinhas do Instagram). */
export const STORY_COLORS = ['#ffffff', '#111111', '#ff3b5c', '#ff8a00', '#ffd60a', '#34c759', '#20c5ff', '#5856d6', '#ff5ed1', '#a2845e'] as const;

/** Figurinhas rápidas (emoji grandes). */
export const STORY_STICKERS = ['🔥', '🎉', '😍', '😂', '🥳', '🍻', '🍹', '💃', '🕺', '🎶', '❤️', '✨', '😎', '🤩', '👏', '📍', '🌙', '☀️', '🍕', '🎤'] as const;

export function nextStyle(style: StoryOverlayStyle): StoryOverlayStyle {
  return STORY_STYLES[(STORY_STYLES.indexOf(style) + 1) % STORY_STYLES.length]!;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Ângulo em graus entre -180 e 180. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Onde a mídia aparece dentro do palco quando encaixada inteira (`object-fit: contain`). */
export function containRect(stage: { width: number; height: number }, media: { width: number; height: number }): Rect {
  if (!(stage.width > 0 && stage.height > 0 && media.width > 0 && media.height > 0)) return { left: 0, top: 0, width: stage.width, height: stage.height };
  const scale = Math.min(stage.width / media.width, stage.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;
  return { left: (stage.width - width) / 2, top: (stage.height - height) / 2, width, height };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Pinça com dois dedos: quanto o item cresce e gira desde o começo do gesto.
 * Devolve a nova escala (dentro dos limites) e o novo giro.
 */
export function pinch(start: [Point, Point], now: [Point, Point], from: { scale: number; rotation: number }): { scale: number; rotation: number } {
  const d0 = Math.hypot(start[1].x - start[0].x, start[1].y - start[0].y);
  const d1 = Math.hypot(now[1].x - now[0].x, now[1].y - now[0].y);
  const a0 = Math.atan2(start[1].y - start[0].y, start[1].x - start[0].x);
  const a1 = Math.atan2(now[1].y - now[0].y, now[1].x - now[0].x);
  const scale = d0 > 0 ? clamp(from.scale * (d1 / d0), SCALE_MIN, SCALE_MAX) : from.scale;
  return { scale, rotation: normalizeAngle(from.rotation + ((a1 - a0) * 180) / Math.PI) };
}

/** O dedo está sobre a lixeira (círculo no pé da tela)? */
export function overTrash(point: Point, trash: { x: number; y: number; radius: number }): boolean {
  return Math.hypot(point.x - trash.x, point.y - trash.y) <= trash.radius;
}

/** Limpa e confere antes de enviar (o servidor confere de novo). Itens vazios saem. */
export function cleanOverlays(items: readonly StoryOverlay[]): StoryOverlay[] {
  return items
    .map((o) => ({ ...o, text: o.text.replace(/\r\n?/g, '\n').trim() }))
    .filter((o) => o.text !== '')
    .slice(0, STORY_OVERLAYS_MAX)
    .map((o) => ({
      ...o,
      text: [...o.text].slice(0, STORY_OVERLAY_TEXT_MAX).join(''),
      x: round(clamp(o.x, 0, 1)),
      y: round(clamp(o.y, 0, 1)),
      scale: round(clamp(o.scale, SCALE_MIN, SCALE_MAX)),
      rotation: round(normalizeAngle(o.rotation)),
    }));
}

/** Cabeçalho `X-Story-Overlays`: JSON em base64 (UTF-8, para emoji e acentos). Sem itens: `undefined`. */
export function overlaysHeader(items: readonly StoryOverlay[]): string | undefined {
  const clean = cleanOverlays(items);
  if (clean.length === 0) return undefined;
  const bytes = new TextEncoder().encode(JSON.stringify(clean));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Cor do texto que contrasta com um fundo (estilo BOX): escuro em cor clara, branco em cor escura. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}

/** Estilo visual de um item, em função da largura da mídia na tela (px). */
export function overlayLook(o: Pick<StoryOverlay, 'kind' | 'color' | 'style' | 'scale'>, mediaWidth: number): Record<string, string> {
  const size = mediaWidth * (o.kind === 'STICKER' ? STICKER_FONT_RATIO : TEXT_FONT_RATIO) * o.scale;
  const look: Record<string, string> = { fontSize: `${Math.max(4, size).toFixed(2)}px` };
  if (o.kind === 'STICKER') return look;
  // Quebra a linha dentro da largura da mídia, por maior que o texto fique: nada sai da tela.
  look.maxWidth = `${(mediaWidth * TEXT_WRAP_RATIO).toFixed(2)}px`;
  switch (o.style) {
    case 'BOX':
      look.color = inkOn(o.color);
      look.backgroundColor = o.color;
      break;
    case 'NEON':
      look.color = '#ffffff';
      look.textShadow = `0 0 ${(size * 0.12).toFixed(1)}px ${o.color}, 0 0 ${(size * 0.35).toFixed(1)}px ${o.color}, 0 0 ${(size * 0.6).toFixed(1)}px ${o.color}`;
      break;
    default:
      look.color = o.color;
  }
  return look;
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
