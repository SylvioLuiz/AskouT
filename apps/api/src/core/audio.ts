import { validationError } from './errors.ts';

/** Mensagem de voz: até 90 s e 600 KB (o app grava a ~32 kbps, então 90 s ficam em ~360 KB). */
export const AUDIO_MAX_BYTES = 600 * 1024;
export const AUDIO_MAX_MS = 90_000;
export const AUDIO_MIN_MS = 1_000;

const AUDIO_RE = /^data:audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)(?:;codecs=[A-Za-z0-9.,\-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/;

export interface DecodedAudio {
  mime: string;
  bytes: Buffer;
}

/** Confere os primeiros bytes (não confia no tipo declarado): webm (Chrome), ogg (Firefox), mp4/m4a (Safari), mp3/aac. */
function looksLike(type: string, b: Buffer): boolean {
  switch (type) {
    case 'webm':
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case 'ogg':
      return b.subarray(0, 4).toString('latin1') === 'OggS';
    case 'mp4':
    case 'x-m4a':
      return b.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'mpeg':
      return b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && ((b[1] as number) & 0xe0) === 0xe0);
    case 'aac':
      return b[0] === 0xff && ((b[1] as number) & 0xf0) === 0xf0;
    default:
      return false;
  }
}

export function decodeAudioDataUrl(value: unknown): DecodedAudio {
  const fail = () => validationError('Áudio inválido', { audio: 'Grave um áudio de até 90 segundos' });
  if (typeof value !== 'string' || value.length > Math.ceil((AUDIO_MAX_BYTES * 4) / 3) + 96) throw fail();
  const match = AUDIO_RE.exec(value);
  if (!match) throw fail();
  const bytes = Buffer.from(match[2] as string, 'base64');
  if (bytes.length < 16 || bytes.length > AUDIO_MAX_BYTES) throw fail();
  const type = match[1] as string;
  if (!looksLike(type, bytes)) throw fail();
  return { mime: `audio/${type}`, bytes };
}

export function parseAudioDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < AUDIO_MIN_MS || value > AUDIO_MAX_MS) {
    throw validationError('Duração inválida', { audio: 'O áudio precisa ter de 1 a 90 segundos' });
  }
  return value;
}
