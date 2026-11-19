import { validationError } from './errors.ts';

/**
 * Textos e figurinhas por cima de um story, como no Instagram.
 * Ficam guardados à parte da mídia e são desenhados por quem assiste: valem para foto e vídeo,
 * continuam nítidos em qualquer tela e o leitor de tela consegue ler.
 *
 * Posição (`x`, `y`) é o centro do item, de 0 a 1 em relação à área da mídia na tela.
 * `scale` multiplica o tamanho base (que é proporcional à largura da mídia); `rotation` em graus.
 */
export type StoryOverlayStyle = 'CLASSIC' | 'BOX' | 'NEON' | 'SERIF';
export const STORY_OVERLAY_STYLES: readonly StoryOverlayStyle[] = ['CLASSIC', 'BOX', 'NEON', 'SERIF'];

export interface StoryOverlay {
  kind: 'TEXT' | 'STICKER';
  text: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Cor do texto (ou do fundo, no estilo BOX), `#rrggbb`. */
  color: string;
  style: StoryOverlayStyle;
}

export const STORY_OVERLAYS_MAX = 12;
export const STORY_OVERLAY_TEXT_MAX = 160;
export const STORY_OVERLAY_SCALE_MIN = 0.3;
export const STORY_OVERLAY_SCALE_MAX = 5;
/** Tamanho do cabeçalho que leva os itens (JSON em base64): bem abaixo do limite de cabeçalhos do Node. */
export const STORY_OVERLAYS_HEADER_MAX = 12_000;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Confere e normaliza a lista vinda do aplicativo. Nada (ou lista vazia) vira `undefined`. */
export function parseStoryOverlays(raw: unknown): StoryOverlay[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const fail = () => validationError('Textos do flash inválidos', { overlays: 'Confira os textos do flash' });
  if (!Array.isArray(raw)) throw fail();
  if (raw.length > STORY_OVERLAYS_MAX) throw validationError('Textos demais no flash', { overlays: `Use até ${STORY_OVERLAYS_MAX} textos ou figurinhas` });
  const out: StoryOverlay[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) throw fail();
    const o = item as Record<string, unknown>;
    const kind = o.kind === 'STICKER' ? 'STICKER' : o.kind === 'TEXT' ? 'TEXT' : undefined;
    if (!kind || typeof o.text !== 'string') throw fail();
    // Sem caracteres de controle (quebra de linha pode).
    const text = o.text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
    if (text === '') continue;
    if ([...text].length > STORY_OVERLAY_TEXT_MAX) throw validationError('Texto do flash muito longo', { overlays: `Cada texto tem até ${STORY_OVERLAY_TEXT_MAX} caracteres` });
    const nums = [o.x, o.y, o.scale, o.rotation];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) throw fail();
    const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color.toLowerCase() : '#ffffff';
    const style = (STORY_OVERLAY_STYLES as readonly unknown[]).includes(o.style) ? (o.style as StoryOverlayStyle) : 'CLASSIC';
    let rotation = (o.rotation as number) % 360;
    if (rotation > 180) rotation -= 360;
    if (rotation < -180) rotation += 360;
    out.push({
      kind,
      text,
      x: round(clamp(o.x as number, 0, 1)),
      y: round(clamp(o.y as number, 0, 1)),
      scale: round(clamp(o.scale as number, STORY_OVERLAY_SCALE_MIN, STORY_OVERLAY_SCALE_MAX)),
      rotation: round(rotation),
      color,
      style,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** O cabeçalho `X-Story-Overlays`: JSON em base64 (UTF-8). Vazio ou ausente: sem textos. */
export function parseStoryOverlaysHeader(header: unknown): StoryOverlay[] | undefined {
  if (typeof header !== 'string' || header.trim() === '') return undefined;
  const fail = () => validationError('Textos do flash inválidos', { overlays: 'Confira os textos do flash' });
  if (header.length > STORY_OVERLAYS_HEADER_MAX) throw validationError('Textos demais no flash', { overlays: 'Os textos do flash passam do limite' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header.trim(), 'base64').toString('utf8'));
  } catch {
    throw fail();
  }
  return parseStoryOverlays(parsed);
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
