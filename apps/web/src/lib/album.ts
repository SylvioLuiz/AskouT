import { t } from './i18n/index.ts';
import type { AlbumSummary } from './types.ts';

/** Nome do álbum na lista: o evento, o lugar do encontro ou, sem nada disso, o padrão de cada tipo. */
export function albumName(album: Pick<AlbumSummary, 'kind' | 'title' | 'placeName'>): string {
  return album.title ?? album.placeName ?? (album.kind === 'FLASH' ? t('Encontro do NOW') : t('Evento'));
}

/** "Com 4 amigos" / "Com 1 amigo" / "Só você". */
export function albumWith(friendCount: number): string {
  if (friendCount <= 0) return t('Só você');
  return friendCount === 1 ? t('Com 1 amigo') : t('Com {n} amigos', { n: friendCount });
}

export function albumPhotosText(photoCount: number): string {
  return photoCount === 1 ? t('1 foto') : t('{n} fotos', { n: photoCount });
}
