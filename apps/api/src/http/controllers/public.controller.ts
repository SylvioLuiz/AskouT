import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { PlacePhotos } from './places.controller.ts';
import type { Core } from '../../core/index.ts';
import type { EventPageView } from '../../core/event-page-service.ts';
import type { ExplorePlaceItem } from '../../core/explore-service.ts';
import { Public } from '../decorators.ts';
import { CORE, PLACE_PHOTOS } from '../tokens.ts';

/**
 * Modo visitante: leituras sem login, de locais, dos eventos deles e da página de evento público de pessoa
 * com perfil público (sem quem vai).
 * Limite próprio por endereço (ver rate-limit-policy). Qualquer ação continua exigindo conta.
 */
@Public()
@Controller('public')
export class PublicController {
  private readonly core: Core;
  private readonly photos: PlacePhotos;

  constructor(@Inject(CORE) core: Core, @Inject(PLACE_PHOTOS) photos: PlacePhotos) {
    this.core = core;
    this.photos = photos;
  }

  private photoPath(ref: string | null): string | null {
    return ref && this.photos.google ? this.photos.signer.path(ref) : null;
  }

  private presentPlaces(places: ExplorePlaceItem[]) {
    return places.map(({ photoRef, ...p }) => ({ ...p, photoPath: this.photoPath(photoRef) }));
  }

  @Get('explore')
  async explore(@Query() query: Record<string, unknown>) {
    const view = await this.core.publicReads.search(query);
    return { ...view, places: this.presentPlaces(view.places) };
  }

  @Get('explore/places')
  async mapPlaces(@Query() query: Record<string, unknown>) {
    const view = await this.core.publicReads.mapPlaces(query);
    return { ...view, places: this.presentPlaces(view.places) };
  }

  @Get('events/:id')
  async event(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const lat = num(query.lat);
    const lng = num(query.lng);
    const view: EventPageView = await this.core.publicReads.event(id, lat !== undefined && lng !== undefined ? { lat, lng } : {});
    const { cover, ...rest } = view;
    const coverPath = !cover ? null : cover.kind === 'URL' ? cover.url : cover.kind === 'UPLOAD' ? `/posts/images/${cover.imageId}` : this.photoPath(cover.photoRef);
    return { ...rest, coverPath, coverVideoPath: cover?.kind === 'UPLOAD' && cover.video ? `/posts/videos/${cover.imageId}` : null, coverAuthor: cover?.kind === 'PLACE' ? cover.author : null };
  }

  @Get('venues/:id')
  async venue(@Param('id') id: string) {
    const { photoRef, ...rest } = await this.core.publicReads.venue(id);
    return { ...rest, photoPath: this.photoPath(photoRef) };
  }
}
