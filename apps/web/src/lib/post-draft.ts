export const POST_IMAGES_MAX = 5;
export const POST_CAPTION_MAX = 500;

export interface DraftUpload {
  key: string;
  kind: 'UPLOAD';
  preview: string;
  dataUrl: string;
}

export interface DraftPlacePhoto {
  key: string;
  kind: 'PLACE';
  preview: string;
  photoPath: string;
  author: string | null;
  placeName: string;
  placeAddress: string | null;
}

export type DraftImage = DraftUpload | DraftPlacePhoto;

export interface LinkedPlace {
  name: string;
  address: string | null;
}

/** Adiciona sem passar de 5 e sem repetir foto de lugar (a nova foto de lugar troca a anterior). */
export function addImages(current: readonly DraftImage[], added: readonly DraftImage[]): DraftImage[] {
  let next = [...current];
  for (const image of added) {
    if (image.kind === 'PLACE') next = next.filter((i) => i.kind !== 'PLACE');
    if (next.length >= POST_IMAGES_MAX) continue;
    next.push(image);
  }
  return next;
}

/** O lugar do post: o da foto do lugar (fixo) ou o que a pessoa vinculou quando só tem fotos próprias. */
export function effectivePlace(images: readonly DraftImage[], linked: LinkedPlace | null): LinkedPlace | null {
  const fromPhoto = images.find((i): i is DraftPlacePhoto => i.kind === 'PLACE');
  if (fromPhoto) return { name: fromPhoto.placeName, address: fromPhoto.placeAddress };
  return linked;
}

/** Corpo do `POST /posts` a partir do rascunho. */
export function buildPostBody(images: readonly DraftImage[], caption: string, linked: LinkedPlace | null, tagUserIds: readonly string[]) {
  const place = effectivePlace(images, linked);
  return {
    images: images.map((i) => (i.kind === 'UPLOAD' ? i.dataUrl : { photoPath: i.photoPath, photoAuthor: i.author })),
    ...(caption.trim() ? { caption: caption.trim() } : {}),
    ...(place ? { placeName: place.name, ...(place.address ? { placeAddress: place.address } : {}) } : {}),
    ...(tagUserIds.length > 0 ? { tagUserIds: [...tagUserIds] } : {}),
  };
}
