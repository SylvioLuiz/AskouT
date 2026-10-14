import { BadRequestException, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { Body } from '@nestjs/common';
import type { PlacePhotos } from './places.controller.ts';
import type { Core } from '../../core/index.ts';
import type { PostImageInput, PostView } from '../../core/post-service.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { CORE, PLACE_PHOTOS } from '../tokens.ts';

@Controller()
export class PostsController {
  private readonly core: Core;
  private readonly photos: PlacePhotos;

  constructor(@Inject(CORE) core: Core, @Inject(PLACE_PHOTOS) photos: PlacePhotos) {
    this.core = core;
    this.photos = photos;
  }

  /** Foto do lugar vem do app como o endereço assinado que a API mesmo emitiu; aqui vira a referência (conferida). */
  private placeRef(photoPath: unknown): string {
    const bad = () => new BadRequestException({ code: 'VALIDATION', message: 'Foto do lugar inválida ou vencida. Escolha o lugar de novo.', fields: { images: 'Foto do lugar inválida' } });
    if (typeof photoPath !== 'string' || photoPath.length > 1500 || !photoPath.startsWith('/places/photo?')) throw bad();
    const url = new URL(photoPath, 'http://api.local');
    const ref = url.searchParams.get('ref');
    const exp = url.searchParams.get('exp');
    const sig = url.searchParams.get('sig');
    if (!this.photos.google || !ref || !exp || !sig || !this.photos.signer.verify(ref, exp, sig)) throw bad();
    return ref;
  }

  private present(post: PostView) {
    return {
      ...post,
      images: post.images.map(({ photoRef, ...i }) => ({
        ...i,
        path: i.kind === 'UPLOAD' ? `/posts/images/${i.id}` : photoRef && this.photos.google ? this.photos.signer.path(photoRef) : null,
      })),
    };
  }

  /** `{images: [dataUrl | {photoPath, photoAuthor}], caption?, placeName?, placeAddress?, tagUserIds?: string[]}` */
  @Post('posts')
  @HttpCode(200)
  async create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    const images = Array.isArray(b.images)
      ? b.images.map((i: unknown): PostImageInput | unknown => {
          if (i && typeof i === 'object') {
            const o = i as { photoPath?: unknown; photoAuthor?: unknown };
            return { placePhotoRef: this.placeRef(o.photoPath), placePhotoAuthor: typeof o.photoAuthor === 'string' ? o.photoAuthor : null };
          }
          return i;
        })
      : b.images;
    return this.present(await this.core.posts.create(actor.userId, { caption: b.caption, images, placeName: b.placeName, placeAddress: b.placeAddress, tagUserIds: b.tagUserIds, event: b.event }));
  }

  /** Seus posts arquivados (só você vê). Vem antes de `posts/:id`. */
  @Get('posts/archived')
  async archived(@CurrentActor() actor: Actor, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const page = await this.core.posts.listArchived(actor.userId, { limit, offset });
    return { ...page, items: page.items.map((p) => this.present(p)) };
  }

  /** Posts seus e dos seus amigos. */
  @Get('posts/feed')
  async feed(@CurrentActor() actor: Actor, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const page = await this.core.posts.feed(actor.userId, { limit, offset });
    return { ...page, items: page.items.map((p) => this.present(p)) };
  }

  /** Posts em que você foi marcado e ainda não respondeu. */
  @Get('posts/pending-tags')
  async pendingTags(@CurrentActor() actor: Actor, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const page = await this.core.posts.pendingTags(actor.userId, { limit, offset });
    return { ...page, items: page.items.map((p) => this.present(p)) };
  }

  /** `{action: 'accept' | 'decline'}`: aceitar (o post entra no seu perfil e feed) ou recusar a marcação. */
  @Post('posts/:id/tag')
  @HttpCode(200)
  respondTag(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.posts.respondTag(actor.userId, id, asBody(body).action);
  }

  /** Foto enviada, para o <img> (que não manda o token). O id é aleatório, como na foto de perfil. */
  @Public()
  @Get('posts/images/:imageId')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(@Param('imageId') imageId: string) {
    const photo = await this.core.posts.image(imageId);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }

  @Get('posts/:id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.present(await this.core.posts.get(actor.userId, id));
  }

  @Delete('posts/:id')
  delete(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.delete(actor.userId, id);
  }

  /** Edita legenda, lugar e evento: `{caption?, placeName?, placeAddress?, event?}` (só o autor). */
  @Patch('posts/:id')
  async edit(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.present(await this.core.posts.update(actor.userId, id, { caption: b.caption, placeName: b.placeName, placeAddress: b.placeAddress, event: b.event }));
  }

  /** Ajuste de uma foto enviada: `{image: dataUrl}` já recortada pelo app (só o autor). */
  @Put('posts/:id/images/:imageId')
  async adjustImage(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('imageId') imageId: string, @Body() body: unknown) {
    return this.present(await this.core.posts.replaceImage(actor.userId, id, imageId, asBody(body).image));
  }

  @Post('posts/:id/archive')
  @HttpCode(200)
  archive(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.archive(actor.userId, id);
  }

  @Delete('posts/:id/archive')
  unarchive(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.unarchive(actor.userId, id);
  }

  @Post('posts/:id/like')
  @HttpCode(200)
  like(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.like(actor.userId, id);
  }

  @Delete('posts/:id/like')
  unlike(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.unlike(actor.userId, id);
  }

  @Get('posts/:id/comments')
  comments(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.core.posts.comments(actor.userId, id, { limit, offset });
  }

  /** `{body}` */
  @Post('posts/:id/comments')
  @HttpCode(200)
  addComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.posts.addComment(actor.userId, id, asBody(body).body);
  }

  @Delete('posts/:id/comments/:commentId')
  deleteComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('commentId') commentId: string) {
    return this.core.posts.deleteComment(actor.userId, id, commentId);
  }

  /** `{reason: SPAM|OFFENSIVE|NUDITY|VIOLENCE|FALSE_INFO|OTHER, details?}` */
  @Post('posts/:id/report')
  @HttpCode(200)
  report(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.posts.report(actor.userId, id, b.reason, b.details);
  }

  @Post('posts/:id/not-interested')
  @HttpCode(200)
  notInterested(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.notInterested(actor.userId, id);
  }

  /** Posts de uma pessoa (perfil privado só para quem segue). */
  @Get('profiles/:username/posts')
  async byUser(@CurrentActor() actor: Actor, @Param('username') username: string, @Query('limit') limit?: string, @Query('offset') offset?: string, @Query('kind') kind?: string) {
    const page = await this.core.posts.listByUsername(actor.userId, username, { limit, offset, kind });
    return { ...page, items: page.items.map((p) => this.present(p)) };
  }
}
