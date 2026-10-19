import { Body, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { CORE, PLACE_PHOTOS } from '../tokens.ts';
import type { PlacePhotos } from './places.controller.ts';
import type { VenueProfileView } from '../../core/venue-service.ts';
import type { PostView, PostsPage } from '../../core/post-service.ts';

/** Painel do local (dentro do perfil): reivindicar um local e cuidar dos eventos dele. */
@Controller()
export class VenuesController {
  private readonly core: Core;

  private readonly photos: PlacePhotos;

  constructor(@Inject(CORE) core: Core, @Inject(PLACE_PHOTOS) photos: PlacePhotos) {
    this.core = core;
    this.photos = photos;
  }

  /** A página leva o caminho assinado da foto do Google (a chave nunca sai do servidor). */
  private present(view: VenueProfileView) {
    const { photoRef, ...rest } = view;
    return { ...rest, photoPath: photoRef && this.photos.google ? this.photos.signer.path(photoRef) : null };
  }

  private presentPost(post: PostView) {
    return { ...post, images: post.images.map(({ photoRef, ...i }) => ({ ...i, path: i.kind === 'UPLOAD' ? `/posts/images/${i.id}` : photoRef && this.photos.google ? this.photos.signer.path(photoRef) : null, videoPath: i.video ? `/posts/videos/${i.id}` : null })) };
  }

  private presentPage(page: PostsPage) {
    return { ...page, items: page.items.map((p) => this.presentPost(p)) };
  }

  /** Capa enviada do aparelho, para o <img>. O endereço leva `?v=` e muda a cada troca. */
  @Public()
  @Get('venues/:id/cover')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async venueCover(@Param('id') id: string) {
    const photo = await this.core.venues.venueCover(id);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }

  /** Logo enviada do aparelho, para o <img>. */
  @Public()
  @Get('venues/:id/logo')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async venueLogo(@Param('id') id: string) {
    const photo = await this.core.venues.venueLogo(id);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }

  /** Abre a página de um lugar que só existe no Google: `{key: "google:ID", lat, lng}` → `{venueId}`. */
  @Post('venues/external')
  @HttpCode(200)
  openExternal(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.venues.openExternal({ key: b.key, lat: b.lat, lng: b.lng });
  }

  @Get('venues/:id/profile')
  async profile(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.present(await this.core.venues.profile(actor.userId, id));
  }

  @Put('me/venues/:id/profile')
  async updateProfile(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.present(await this.core.venues.updateProfile(actor.userId, id, asBody(body)));
  }

  @Post('venues/:id/follow')
  @HttpCode(200)
  follow(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.follow(actor.userId, id);
  }

  @Delete('venues/:id/follow')
  unfollow(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.unfollow(actor.userId, id);
  }

  @Put('venues/:id/rating')
  rate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: { stars?: unknown }) {
    return this.core.venues.rate(actor.userId, id, body?.stars);
  }

  @Delete('venues/:id/rating')
  clearRating(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.clearRating(actor.userId, id);
  }

  /** Posts feitos em nome do local. */
  @Get('venues/:id/posts')
  async posts(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: { limit?: string; offset?: string }) {
    return this.presentPage(await this.core.posts.listByVenue(actor.userId, id, query));
  }

  /** Publica em nome do local (quem administra): `{caption?, images: [dataUrl]}`. */
  @Post('me/venues/:id/posts')
  @HttpCode(200)
  async createPost(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.presentPost(await this.core.posts.createForVenue(actor.userId, id, { caption: b.caption, images: b.images }));
  }

  /** Capa enviada do aparelho, para o <img> (que não manda o token). O endereço leva `?v=` e muda a cada troca. */
  @Public()
  @Get('place-events/:id/cover')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async cover(@Param('id') id: string) {
    const photo = await this.core.venues.eventCover(id);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }

  /** Meus locais e meus pedidos de reivindicação. */
  @Get('me/venues')
  mine(@CurrentActor() actor: Actor) {
    return this.core.venues.mine(actor.userId);
  }

  /** Busca locais pelo nome para reivindicar. */
  @Get('venues/claimable')
  claimable(@CurrentActor() actor: Actor, @Query('q') q: unknown) {
    return this.core.venues.searchClaimable(actor.userId, q);
  }

  /** `{document: dataUrl, note?}` */
  @Post('venues/:id/claims')
  @HttpCode(200)
  claim(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.venues.requestClaim(actor.userId, id, { document: b.document, note: b.note });
  }

  @Delete('venue-claims/:id')
  cancelClaim(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.cancelClaim(actor.userId, id);
  }

  @Get('me/venues/:id')
  panel(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.panel(actor.userId, id);
  }

  @Post('me/venues/:id/events')
  @HttpCode(200)
  createEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.venues.createEvent(actor.userId, id, asBody(body));
  }

  @Put('me/venues/:id/events/:eventId')
  updateEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.core.venues.updateEvent(actor.userId, id, eventId, asBody(body));
  }

  @Delete('me/venues/:id/events/:eventId')
  deleteEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string) {
    return this.core.venues.deleteEvent(actor.userId, id, eventId);
  }
}
