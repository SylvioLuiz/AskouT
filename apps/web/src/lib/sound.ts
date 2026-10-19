import type { PostImage } from './types.ts';

/**
 * Este item tem som para ligar e desligar? Hoje só o vídeo.
 * Quando as fotos puderem ter música, é só somar aqui o endereço da música (ex.: `|| image.musicPath`).
 */
export function hasSound(image: Pick<PostImage, 'videoPath'>): boolean {
  return Boolean(image.videoPath);
}
