import { Body, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { PlacePhotos } from './places.controller.ts';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import type { EventCoverView, EventPageView, EventPostView } from '../../core/event-page-service.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor, Public } from '../decorators.ts';
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

  /** Posta o evento no seu perfil. */
  @Post('events/:id/post')
  @HttpCode(200)
  post(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.profileEvents.post(actor.userId, id);
  }

  @Delete('events/:id/post')
  unpost(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.profileEvents.unpost(actor.userId, id);
  }

  /** Página do evento (do local ou criado por uma pessoa). */
  @Get('events/:id')
  async event(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const lat = num(query.lat);
    const lng = num(query.lng);
    return this.presentPage(await this.core.eventPages.get(actor.userId, id, lat !== undefined && lng !== undefined ? { lat, lng } : {}));
  }

  /** "Eu vou". */
  @Post('events/:id/going')
  @HttpCode(200)
  async go(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.presentPage(await this.core.eventPages.go(actor.userId, id));
  }

  @Delete('events/:id/going')
  async cancel(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.presentPage(await this.core.eventPages.cancel(actor.userId, id));
  }

  /** `{public: boolean}`: quem pode postar no evento (só o dono). */
  @Put('events/:id/posts-public')
  async postsPublic(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.presentPage(await this.core.eventPages.setPostsPublic(actor.userId, id, asBody(body).public));
  }

  /** `{caption, image?: dataUrl}` */
  @Post('events/:id/posts')
  @HttpCode(200)
  async createPost(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.presentPost(await this.core.eventPages.createPost(actor.userId, id, { caption: b.caption, image: b.image }));
  }

  @Delete('events/:id/posts/:postId')
  deletePost(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('postId') postId: string) {
    return this.core.eventPages.deletePost(actor.userId, id, postId);
  }

  /** Foto de um post de evento, para o <img> (que não manda o token). O id é aleatório, como nas fotos dos posts. */
  @Public()
  @Get('event-posts/:postId/image')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async postImage(@Param('postId') postId: string) {
    const photo = await this.core.eventPages.postImage(postId);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }

  private coverPath(cover: EventCoverView | null): string | null {
    if (!cover) return null;
    if (cover.kind === 'URL') return cover.url;
    if (cover.kind === 'UPLOAD') return `/posts/images/${cover.imageId}`;
    return this.photos.google ? this.photos.signer.path(cover.photoRef) : null;
  }

  private presentPost(post: EventPostView) {
    const { hasImage, ...rest } = post;
    return { ...rest, imagePath: hasImage ? `/event-posts/${post.id}/image` : null };
  }

  private presentPage(view: EventPageView) {
    const { cover, ...rest } = view;
    return { ...rest, coverPath: this.coverPath(cover), coverAuthor: cover?.kind === 'PLACE' ? cover.author : null, posts: view.posts.map((p) => this.presentPost(p)) };
  }
}
