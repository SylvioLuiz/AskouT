import { validationError } from './errors.ts';

/** Foto na conversa: o app reduz antes de enviar (lado maior 1600 px); aqui o teto é de 2 MB. */
export const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Vídeo na conversa: até 60 MB, como nos posts e stories (o app reduz antes de enviar). */
export const CHAT_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
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

/** Arquivo na conversa (PDF, Word, Excel, PowerPoint, texto): até 25 MB, como os apps de mensagem costumam aceitar por padrão. */
export const CHAT_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_FILE_NAME_MAX = 120;

/** Tipos de documento aceitos e como conferir os primeiros bytes de cada um. */
const ZIP = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const OLE = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
const PDF = (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-';
const TEXT = (b: Buffer) => !b.subarray(0, 4096).includes(0);
export const CHAT_FILE_TYPES: Readonly<Record<string, (b: Buffer) => boolean>> = {
  'application/pdf': PDF,
  'application/msword': OLE,
  'application/vnd.ms-excel': OLE,
  'application/vnd.ms-powerpoint': OLE,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ZIP,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ZIP,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ZIP,
  'application/vnd.oasis.opendocument.text': ZIP,
  'application/vnd.oasis.opendocument.spreadsheet': ZIP,
  'application/vnd.oasis.opendocument.presentation': ZIP,
  'application/rtf': (b) => b.subarray(0, 5).toString('latin1') === '{\\rtf',
  'text/plain': TEXT,
  'text/csv': TEXT,
};

export interface ChatFile {
  mime: string;
  name: string;
  data: Uint8Array;
}

/** Nome do arquivo como a pessoa vê: sem pasta, sem caracteres de controle, até 120 letras (a extensão fica). */
export function cleanFileName(value: unknown): string {
  let name = typeof value === 'string' ? value : '';
  name = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').trim();
  if (name === '' || name === '.' || name === '..') return 'arquivo';
  const chars = Array.from(name);
  if (chars.length <= CHAT_FILE_NAME_MAX) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  return Array.from(name.slice(0, name.length - ext.length)).slice(0, CHAT_FILE_NAME_MAX - ext.length).join('') + ext;
}

/** Confere tipo, tamanho e primeiros bytes de um documento enviado na conversa. */
export function parseChatFile(mimeInput: unknown, bytes: unknown, nameInput: unknown): ChatFile {
  const mime = baseMime(mimeInput);
  const fail = (message: string) => validationError(message, { file: message });
  const check = CHAT_FILE_TYPES[mime];
  if (!check) throw fail('Envie um PDF, documento, planilha, apresentação ou texto');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw fail('Arquivo vazio');
  if (bytes.length > CHAT_FILE_MAX_BYTES) throw fail('O arquivo passa de 25 MB');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!check(b)) throw fail('O arquivo não parece ser do tipo informado');
  return { mime, name: cleanFileName(nameInput), data: new Uint8Array(b) };
}
