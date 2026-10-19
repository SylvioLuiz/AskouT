import { resizePostPhoto } from './image.ts';

/** Vídeo no post: até 60 MB e até 3 minutos. */
export const POST_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
export const POST_VIDEO_MAX_SECONDS = 180;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/** Motivo de não aceitar o arquivo como vídeo do post, ou undefined se serve. */
export function videoProblem(file: { type: string; size: number }): string | undefined {
  if (!VIDEO_TYPES.includes(file.type.split(';')[0]?.trim().toLowerCase() ?? '')) return 'Use um vídeo MP4, WebM ou MOV.';
  if (file.size === 0) return 'O vídeo está vazio.';
  if (file.size > POST_VIDEO_MAX_BYTES) return 'O vídeo passa de 60 MB. Escolha um mais curto.';
  return undefined;
}

/** Motivo de recusar pela duração, ou undefined. Duração desconhecida (infinita) não passa. */
export function durationProblem(seconds: number): string | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Não foi possível saber a duração deste vídeo.';
  if (seconds > POST_VIDEO_MAX_SECONDS + 0.5) return 'O vídeo passa de 3 minutos. Escolha um mais curto.';
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
      video.onerror = () => reject(new Error('Não foi possível ler este vídeo. Tente outro arquivo.'));
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
    if (width === 0 || height === 0) throw new Error('Não foi possível ler este vídeo. Tente outro arquivo.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Não foi possível ler este vídeo. Tente outro arquivo.');
    return { poster: await resizePostPhoto(new File([blob], 'capa.jpg', { type: 'image/jpeg' })), seconds };
  } finally {
    URL.revokeObjectURL(url);
  }
}
