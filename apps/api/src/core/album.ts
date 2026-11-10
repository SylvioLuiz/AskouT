import type { EventRef } from './types.ts';

/** De onde vem o álbum: um encontro do NOW (`refId` = id do convite) ou um evento (`refId` = `PLACE:<id>` ou `USER:<id>`). */
export type AlbumKind = 'FLASH' | 'EVENT';

/** Álbum do encontro: fotos só de quem foi. Os participantes ficam gravados aqui (o convite do NOW some do banco em 24 h). */
export interface AlbumRecord {
  id: string;
  kind: AlbumKind;
  refId: string;
  /** Nome do evento; vazio no NOW. */
  title: string | null;
  /** Lugar do evento ou do encontro, quando se sabe. */
  placeName: string | null;
  /** Quando o encontro ou evento começou: o álbum abre aqui e o aviso do dia seguinte conta a partir daqui. */
  startedAt: Date;
  createdAt: Date;
}

export interface AlbumPhotoRecord {
  id: string;
  albumId: string;
  authorId: string;
  mime: string;
  data: Uint8Array;
  createdAt: Date;
}

export type AlbumPhotoMeta = Omit<AlbumPhotoRecord, 'data' | 'mime'>;

export function eventRefId(ref: EventRef): string {
  return `${ref.source}:${ref.id}`;
}
