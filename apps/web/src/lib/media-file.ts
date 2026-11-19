import { t } from './i18n/index.ts';
import { POST_VIDEO_MAX_BYTES, VIDEO_STILL_TOO_BIG } from './post-video.ts';
import { prepareVideo } from './video-prepare.ts';

/**
 * Alguns aparelhos (Android, arquivos vindos de nuvem) entregam o arquivo sem tipo ou com um tipo alternativo
 * ("video/x-m4v"). Sem o tipo certo, o servidor recusa o envio. Aqui o tipo é deduzido pela extensão.
 */
const BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
const ALIASES: Record<string, string> = { 'video/x-m4v': 'video/mp4', 'video/m4v': 'video/mp4', 'video/x-quicktime': 'video/quicktime', 'image/jpg': 'image/jpeg' };

/** O tipo que o arquivo deveria ter (sem parâmetros, em minúsculas). */
export function mediaTypeOf(file: { name: string; type: string }): string {
  const declared = (file.type.split(';')[0] ?? '').trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream') return ALIASES[declared] ?? declared;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? declared;
}

/** O mesmo arquivo com o tipo corrigido (ou ele próprio, se já estava certo). */
export function withMediaType(file: File): File {
  const type = mediaTypeOf(file);
  if (!type || type === file.type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

/**
 * Prepara um vídeo para enviar (story, conversa): reduz como nos posts e confere o limite de envio.
 * Sem isso, vídeo de celular (dezenas de MB) era recusado pelo tamanho fora dos posts.
 */
export async function prepareVideoUpload(file: File, onProgress?: (fraction: number) => void): Promise<File> {
  const prepared = await prepareVideo(withMediaType(file), onProgress ? { onProgress } : {});
  const out = withMediaType(prepared.file);
  if (out.size > POST_VIDEO_MAX_BYTES) throw new Error(VIDEO_STILL_TOO_BIG);
  if (out.size === 0) throw new Error(t('O vídeo está vazio.'));
  return out;
}
