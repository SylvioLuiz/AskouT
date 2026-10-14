import { cropToPixels } from './crop.ts';
import type { CropRect } from './crop.ts';

/** Maior lado da foto do grupo, em pixels. */
export const GROUP_PHOTO_SIDE = 256;
/** Limite que a API aceita para a imagem já decodificada (40 KB). */
export const GROUP_PHOTO_MAX_BYTES = 40 * 1024;

/** Tamanho final mantendo a proporção, sem ampliar. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Bytes de uma imagem em data URL base64. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? '' : dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Só mostra imagens que o próprio app gerou (data URL de imagem). */
export function safeGroupImage(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : null;
}

export interface ResizeOptions {
  /** Maior lado final, em pixels. */
  side: number;
  /** Limite de bytes da imagem final. */
  maxBytes: number;
}

/** Reduz a foto escolhida para caber no limite da API. Lança Error com texto claro se não der. */
export async function resizePhoto(file: File, options: ResizeOptions): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível ler essa imagem. Tente uma foto JPEG ou PNG.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, options.side);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.startsWith('data:image/jpeg') && dataUrlBytes(url) <= options.maxBytes) return url;
  }
  throw new Error('A imagem ficou grande demais mesmo reduzida. Escolha outra.');
}

export const resizeGroupPhoto = (file: File) => resizePhoto(file, { side: GROUP_PHOTO_SIDE, maxBytes: GROUP_PHOTO_MAX_BYTES });

/** Foto de perfil: até 384 px e 56 KB (a API aceita até 60 KB). */
export const PROFILE_PHOTO_SIDE = 384;
export const PROFILE_PHOTO_MAX_BYTES = 56 * 1024;
export const resizeProfilePhoto = (file: File) => resizePhoto(file, { side: PROFILE_PHOTO_SIDE, maxBytes: PROFILE_PHOTO_MAX_BYTES });

/** Foto de post: até 720 px e 95 KB (a API aceita até 100 KB por foto). */
export const POST_PHOTO_SIDE = 720;
export const POST_PHOTO_MAX_BYTES = 95 * 1024;
export const resizePostPhoto = (file: File) => resizePhoto(file, { side: POST_PHOTO_SIDE, maxBytes: POST_PHOTO_MAX_BYTES });

/** Cópia de trabalho para recortar: até 1600 px, sem limite de bytes (só fica na memória do aparelho). */
export const POST_SOURCE_SIDE = 1600;

function paint(source: CanvasImageSource, region: { sx: number; sy: number; sw: number; sh: number }, out: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, region.sx, region.sy, region.sw, region.sh, 0, 0, out.width, out.height);
  return canvas;
}

function jpegWithin(canvas: HTMLCanvasElement, maxBytes: number): string {
  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.startsWith('data:image/jpeg') && dataUrlBytes(url) <= maxBytes) return url;
  }
  throw new Error('A imagem ficou grande demais mesmo reduzida. Escolha outra.');
}

export async function readPostSource(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível ler essa imagem. Tente uma foto JPEG ou PNG.');
  }
  const size = fitWithin(bitmap.width, bitmap.height, POST_SOURCE_SIDE);
  const canvas = paint(bitmap, { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height }, size);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** Recorta a cópia de trabalho e reduz para o limite do post (720 px, 95 KB). */
export async function cropPostPhoto(source: string, rect: CropRect): Promise<string> {
  const img = new Image();
  img.src = source;
  try {
    await img.decode();
  } catch {
    throw new Error('Não foi possível abrir a foto para recortar.');
  }
  const region = cropToPixels(rect, img.naturalWidth, img.naturalHeight);
  const size = fitWithin(region.sw, region.sh, POST_PHOTO_SIDE);
  return jpegWithin(paint(img, region, size), POST_PHOTO_MAX_BYTES);
}
