import { validationError } from './errors.ts';

/** Mensagem de voz: até 90 s e 600 KB (o app grava a ~32 kbps, então 90 s ficam em ~360 KB). */
export const AUDIO_MAX_BYTES = 600 * 1024;
export const AUDIO_MAX_MS = 90_000;
export const AUDIO_MIN_MS = 1_000;

// Cada navegador escreve o tipo de um jeito: "audio/webm;codecs=opus", "audio/ogg; codecs=opus", "audio/mp4;codecs=mp4a.40.2"...
// Aceita qualquer parâmetro depois do tipo; o que vale é o tipo e os primeiros bytes do arquivo.
const AUDIO_RE = /^data:audio\/(webm|ogg|mp4|mpeg|mp3|aac|x-m4a|m4a|x-matroska)\s*(?:;\s*[A-Za-z0-9._-]+\s*=\s*"?[A-Za-z0-9.,\-+ ]+"?\s*)*;base64,([A-Za-z0-9+/\s]+={0,2})$/i;

export interface DecodedAudio {
  mime: string;
  bytes: Buffer;
}

/** Confere os primeiros bytes (não confia no tipo declarado): webm (Chrome), ogg (Firefox), mp4/m4a (Safari), mp3/aac. */
function looksLike(type: string, b: Buffer): boolean {
  switch (type) {
    case 'ogg':
      return b.subarray(0, 4).toString('latin1') === 'OggS';
    case 'mp4':
    case 'x-m4a':
    case 'm4a':
      // Safari grava mp4 "fragmentado": o começo pode ser ftyp, styp, moov, moof, mdat...
      return ['ftyp', 'styp', 'moov', 'moof', 'mdat', 'free', 'wide', 'skip'].includes(b.subarray(4, 8).toString('latin1'));
    case 'x-matroska':
    case 'webm':
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case 'mp3':
    case 'mpeg':
      return b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && ((b[1] as number) & 0xe0) === 0xe0);
    case 'aac':
      return b[0] === 0xff && ((b[1] as number) & 0xf0) === 0xf0;
    default:
      return false;
  }
}

export function decodeAudioDataUrl(value: unknown): DecodedAudio {
  const fail = (why: string) => validationError('Áudio inválido', { audio: `Não foi possível usar este áudio (${why}). Grave de novo, com até 90 segundos` });
  if (typeof value !== 'string') throw fail('formato');
  if (value.length > Math.ceil((AUDIO_MAX_BYTES * 4) / 3) + 128) throw fail('grande demais');
  const match = AUDIO_RE.exec(value);
  if (!match) throw fail(`tipo ${/^data:([^;,]*)/.exec(value)?.[1]?.slice(0, 40) || 'desconhecido'}`);
  const bytes = Buffer.from((match[2] as string).replace(/\s/g, ''), 'base64');
  if (bytes.length < 16) throw fail('vazio');
  if (bytes.length > AUDIO_MAX_BYTES) throw fail('grande demais');
  const type = (match[1] as string).toLowerCase();
  if (!looksLike(type, bytes)) throw fail(`arquivo ${type} não reconhecido`);
  const mime = type === 'x-matroska' ? 'webm' : type === 'mp3' ? 'mpeg' : type === 'm4a' ? 'x-m4a' : type;
  return { mime: `audio/${mime}`, bytes };
}

export function parseAudioDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < AUDIO_MIN_MS || value > AUDIO_MAX_MS) {
    throw validationError('Duração inválida', { audio: 'O áudio precisa ter de 1 a 90 segundos' });
  }
  return value;
}
