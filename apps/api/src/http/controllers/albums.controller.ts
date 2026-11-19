import { Body, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { PostView } from '../../core/post-service.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/** Álbum do encontro: tudo exige token e ser de quem foi (as fotos não são públicas, ao contrário das de post). */
@Controller('albums')
export class AlbumsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.core.albums.list(actor.userId).then((items) => ({ items }));
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.albums.get(actor.userId, id);
  }

  /** `{image: dataUrl}`: foto já reduzida pelo app (até 100 KB). */
  @Post(':id/photos')
  add(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.albums.addPhoto(actor.userId, id, asBody(body).image);
  }

  /** Bytes da foto. O app busca com o token e mostra como imagem local; nada de cache compartilhado. */
  @Get(':id/photos/:photoId')
  @Header('Cache-Control', 'private, max-age=3600')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('photoId', new ParseUUIDPipe()) photoId: string) {
    const media = await this.core.albums.photoMedia(actor.userId, id, photoId);
    if (!media) throw new NotFoundException();
    return new StreamableFile(media.data, { type: media.mime });
  }

  @Delete(':id/photos/:photoId')
  async remove(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('photoId', new ParseUUIDPipe()) photoId: string) {
    await this.core.albums.deletePhoto(actor.userId, id, photoId);
    return { ok: true };
  }

  /** `{caption?}`: publica no perfil de quem pede a foto que a própria pessoa enviou. */
  @Post(':id/photos/:photoId/post')
  @HttpCode(201)
  async postToProfile(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('photoId', new ParseUUIDPipe()) photoId: string, @Body() body: unknown): Promise<{ id: string; post: PostView }> {
    const post = await this.core.albums.postToProfile(actor.userId, id, photoId, asBody(body).caption);
    return { id: post.id, post };
  }
}
