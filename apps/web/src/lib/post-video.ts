import { t } from '../lib/i18n/index.ts';
import { resizePostPhoto } from './image.ts';

/** Vídeo no post: até 60 MB e até 3 minutos. */
export const POST_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
export const POST_VIDEO_MAX_SECONDS = 180;
/** Com compressão disponível, dá para escolher um vídeo bem maior que o limite de envio (ex.: 4K do iPhone). */
export const POST_VIDEO_SOURCE_MAX_BYTES = 500 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/**
 * Motivo de não aceitar o arquivo como vídeo do post, ou undefined se serve.
 * Com `canCompress`, o vídeo pode passar de 60 MB (até 500 MB): ele é reduzido antes de enviar.
 */
export function videoProblem(file: { type: string; size: number }, options: { canCompress?: boolean } = {}): string | undefined {
  if (!VIDEO_TYPES.includes(file.type.split(';')[0]?.trim().toLowerCase() ?? '')) return 'Use um vídeo MP4, WebM ou MOV.';
  if (file.size === 0) return t('O vídeo está vazio.');
  if (options.canCompress) {
    if (file.size > POST_VIDEO_SOURCE_MAX_BYTES) return t('O vídeo passa de 500 MB. Escolha um mais curto.');
    return undefined;
  }
  if (file.size > POST_VIDEO_MAX_BYTES) return t('O vídeo passa de 60 MB. Escolha um mais curto.');
  return undefined;
}

/** Depois de otimizar, ainda não coube no limite de envio. */
export const VIDEO_STILL_TOO_BIG = t('Não foi possível reduzir o vídeo para menos de 60 MB neste aparelho. Escolha um mais curto.');

/** Motivo de recusar pela duração, ou undefined. Duração desconhecida (infinita) não passa. */
export function durationProblem(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return t('Não foi possível saber a duração deste vídeo.');
  if (seconds > POST_VIDEO_MAX_SECONDS + 0.5) return t('O vídeo passa de 3 minutos. Escolha um mais curto.');
  return undefined;
}

export const isVideoFile = (file: { type: string }): boolean => file.type.startsWith('video/');

/** Um quadro do começo do vídeo, como foto reduzida (a capa do post, no mesmo limite das fotos), e a duração dele. */
export async function videoPoster(file: File): Promise<{ poster: string; seconds: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error(t('Não foi possível ler este vídeo. Tente outro arquivo.')));
    });
    const seconds = video.duration;
    const tooLong = durationProblem(seconds);
    if (tooLong) throw new Error(tooLong);
    video.currentTime = Math.min(0.5, seconds / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 1500);
    });
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) throw new Error(t('Não foi possível ler este vídeo. Tente outro arquivo.'));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error(t('Não foi possível ler este vídeo. Tente outro arquivo.'));
    return { poster: await resizePostPhoto(new File([blob], 'capa.jpg', { type: 'image/jpeg' })), seconds };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "Enviando o vídeo: 25 de 60 MB (42%)". Sem total conhecido, só o que já foi. */
export function uploadProgressText(sent: number, total: number): string {
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1).replace('.', ',');
  if (!Number.isFinite(total) || total <= 0) return t('Enviando o vídeo: {sent} MB', { sent: mb(Math.max(0, sent)) });
  const done = Math.min(Math.max(0, sent), total);
  return t('Enviando o vídeo: {done} de {total} MB ({total2}%)', { done: mb(done), total: mb(total), total2: Math.min(100, Math.floor((done / total) * 100)) });
}
