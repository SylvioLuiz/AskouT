import { Controller, Get, Header, Inject, NotFoundException, Query, StreamableFile } from '@nestjs/common';
import type { GooglePlaceSource } from '../../infra/google/google-place-source.ts';
import { Public } from '../decorators.ts';
import { PhotoSigner } from '../support/photo-signing.ts';
import { PLACE_PHOTOS } from '../tokens.ts';

export interface PlacePhotos {
  google: GooglePlaceSource | undefined;
  signer: PhotoSigner;
}

@Controller('places')
export class PlacesController {
  private readonly photos: PlacePhotos;

  constructor(@Inject(PLACE_PHOTOS) photos: PlacePhotos) {
    this.photos = photos;
  }

  /** Foto de um lugar do Google, buscada pelo servidor (a chave não sai daqui). Exige o endereço assinado. */
  @Public()
  @Get('photo')
  @Header('Cache-Control', 'private, max-age=1800')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(@Query('ref') ref?: string, @Query('exp') exp?: string, @Query('sig') sig?: string) {
    if (!this.photos.google || !ref || !exp || !sig || !this.photos.signer.verify(ref, exp, sig)) throw new NotFoundException();
    const photo = await this.photos.google.photo(ref);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.bytes, { type: photo.type });
  }
}
