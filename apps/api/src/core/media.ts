import { validationError } from './errors.ts';

/** Foto na conversa: o app reduz antes de enviar (lado maior 1600 px); aqui o teto é de 2 MB. */
export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Vídeo na conversa: curto, até 20 MB. */
export const CHAT_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
/** Vídeo em post: até 60 MB (a duração, até 3 minutos, o app confere antes de enviar). */
export const POST_VIDEO_MAX_BYTES = 60 * 1024 * 1024;

export interface ChatMedia {
  kind: 'IMAGE' | 'VIDEO';
  mime: string;
  data: Uint8Array;
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

/** Tipo sem parâmetros ("video/webm;codecs=vp9" → "video/webm"), em minúsculas. */
export function baseMime(value: unknown): string {
  return typeof value === 'string' ? (value.split(';')[0] ?? '').trim().toLowerCase() : '';
}

/** Confere o tipo declarado e os primeiros bytes (não confia só no tipo). */
export function parseChatMedia(mimeInput: unknown, bytes: unknown, maxVideoBytes: number = CHAT_VIDEO_MAX_BYTES): ChatMedia {
  const mime = baseMime(mimeInput);
  const fail = (message: string) => validationError(message, { media: message });
  if (!IMAGE_MIMES.includes(mime) && !VIDEO_MIMES.includes(mime)) throw fail('Envie uma foto (JPEG, PNG ou WebP) ou um vídeo (MP4, WebM ou MOV)');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw fail('Arquivo vazio');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isImage = IMAGE_MIMES.includes(mime);
  if (b.length > (isImage ? CHAT_IMAGE_MAX_BYTES : maxVideoBytes)) throw fail(isImage ? 'A foto passa de 2 MB' : `O vídeo passa de ${Math.round(maxVideoBytes / (1024 * 1024))} MB`);
  const ok =
    (mime === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (mime === 'image/png' && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mime === 'image/webp' && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') ||
    ((mime === 'video/mp4' || mime === 'video/quicktime') && b.subarray(4, 8).toString('latin1') === 'ftyp') ||
    (mime === 'video/webm' && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3);
  if (!ok) throw fail('O arquivo não parece ser do tipo informado');
  return { kind: isImage ? 'IMAGE' : 'VIDEO', mime, data: new Uint8Array(b) };
}
