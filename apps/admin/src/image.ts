/** Capa e logo anexadas na gestão: reduz no navegador para caber no limite da API (como o app do dono faz). */

/** Capa do local: até 1280 px e 240 KB (a API aceita até 256 KB). */
export const VENUE_COVER = { side: 1280, maxBytes: 240 * 1024 } as const;
/** Logo do local: até 384 px e 120 KB (a API aceita até 128 KB). */
export const VENUE_LOGO = { side: 384, maxBytes: 120 * 1024 } as const;

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

/**
 * Endereço que o <img> da gestão abre: https fica como está; a capa/logo enviada pelo app vem como caminho da API
 * (`/venues/:id/cover?v=`), que precisa do endereço da API na frente; anexo ainda não salvo é data URL.
 */
export function mediaSrc(apiBase: string, value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https:\/\//i.test(value) || /^data:image\/(jpeg|png|webp);base64,/.test(value)) return value;
  if (value.startsWith('/')) return `${apiBase}${value}`;
  return null;
}

/** Lê o arquivo escolhido e reduz para JPEG dentro do limite. Lança Error com texto claro se não der. */
export async function resizeImage(file: File, limit: { side: number; maxBytes: number }): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem (JPEG, PNG ou WebP).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível ler essa imagem. Tente um JPEG ou PNG.');
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, limit.side);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('O navegador não conseguiu preparar a imagem.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.3]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.startsWith('data:image/jpeg') && dataUrlBytes(url) <= limit.maxBytes) return url;
  }
  throw new Error('A imagem ficou grande demais mesmo reduzida. Escolha outra.');
}
