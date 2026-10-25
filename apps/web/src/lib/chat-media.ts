import { t } from '../lib/i18n/index.ts';
// Foto e vídeo na conversa: limites, redução da foto antes de enviar e textos do "digitando…".

export const CHAT_IMAGE_SIDE = 1600;
export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type PickedMedia = { kind: 'IMAGE' | 'VIDEO'; file: File };

/** Dimensões que cabem em `max` no maior lado, sem ampliar e mantendo a proporção. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Texto de erro se o arquivo não serve (tipo ou tamanho); `null` se pode seguir. Foto grande é reduzida, então só o vídeo tem teto aqui. */
export function mediaProblem(file: { type: string; size: number }): string | null {
  const type = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (file.size <= 0) return t('O arquivo está vazio.');
  if (type.startsWith('image/')) return IMAGE_TYPES.includes(type) || type === 'image/heic' || type === 'image/heif' ? null : t('Use uma foto JPEG, PNG ou WebP.');
  if (type.startsWith('video/')) {
    if (!VIDEO_TYPES.includes(type)) return t('Use um vídeo MP4, WebM ou MOV.');
    return file.size > CHAT_VIDEO_MAX_BYTES ? t('O vídeo passa de 20 MB. Escolha um mais curto.') : null;
  }
  return t('Escolha uma foto ou um vídeo.');
}

export function mediaKind(file: { type: string }): 'IMAGE' | 'VIDEO' | null {
  if (file.type.startsWith('image/')) return 'IMAGE';
  if (file.type.startsWith('video/')) return 'VIDEO';
  return null;
}

/** Reduz a foto (lado maior 1600 px) e converte para JPEG; no navegador. Se já for pequena e JPEG, segue como está. */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/jpeg' && file.size <= 400 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, CHAT_IMAGE_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= CHAT_IMAGE_MAX_BYTES) return blob;
  }
  throw new Error('grande');
}

/** "Bia está digitando…", "Bia e Caio estão digitando…", "3 pessoas estão digitando…". */
export function typingLabel(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} está digitando…`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`;
  return `${names.length} pessoas estão digitando…`;
}
