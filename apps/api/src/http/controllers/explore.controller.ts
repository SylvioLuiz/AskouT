import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { PlacePhotos } from './places.controller.ts';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE, PLACE_PHOTOS } from '../tokens.ts';

@Controller()
export class ExploreController {
  private readonly core: Core;
  private readonly photos: PlacePhotos;

  constructor(@Inject(CORE) core: Core, @Inject(PLACE_PHOTOS) photos: PlacePhotos) {
    this.core = core;
    this.photos = photos;
  }

  /** Explorar: eventos perto (sem q) ou busca de eventos, locais, pessoas e #. A posição só vale para esta consulta. */
  @Get('explore')
  async explore(@CurrentActor() actor: Actor, @Query() query: Record<string, unknown>) {
    const view = await this.core.explore.search(actor.userId, query);
    // A referência da foto do Google não sai da API: o app recebe um endereço assinado e com validade.
    return {
      ...view,
      places: view.places.map(({ photoRef, ...p }) => ({ ...p, photoPath: photoRef && this.photos.google ? this.photos.signer.path(photoRef) : null })),
    };
  }

  @Get('events/:id')
  event(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.core.explore.event(actor.userId, id, { lat: query.lat, lng: query.lng });
  }
}
