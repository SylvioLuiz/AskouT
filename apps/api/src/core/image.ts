import { validationError } from './errors.ts';

const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export interface DecodedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer;
}

/**
 * Aceita só jpeg/png/webp em base64 dentro do limite, conferindo os primeiros bytes (não confia no tipo declarado).
 * `label` aparece na mensagem de erro, ex.: "40 KB".
 */
export function decodeImageDataUrl(value: unknown, maxBytes: number, label: string): DecodedImage {
  const fail = () => validationError('Imagem inválida', { image: `Use uma imagem JPEG, PNG ou WebP de até ${label}` });
  if (typeof value !== 'string' || value.length > Math.ceil((maxBytes * 4) / 3) + 64) throw fail();
  const match = IMAGE_RE.exec(value);
  if (!match) throw fail();
  const bytes = Buffer.from(match[2] as string, 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes) throw fail();
  const type = match[1];
  const ok =
    (type === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (type === 'png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (type === 'webp' && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP');
  if (!ok) throw fail();
  return { mime: `image/${type}` as DecodedImage['mime'], bytes };
}
