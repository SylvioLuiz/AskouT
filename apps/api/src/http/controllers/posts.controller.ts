import { BadRequestException, Controller, Delete, Get, Header, Headers, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
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
    const bad = () => new BadRequestException({ code: 'VALIDATION', message: 'Foto do local inválida ou vencida. Escolha o local de novo.', fields: { images: 'Foto do local inválida' } });
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
        videoPath: i.video ? `/posts/videos/${i.id}` : null,
      })),
    };
  }

  /** `{images?: [dataUrl | {photoPath, photoAuthor}], caption?, placeName?, placeAddress?, placeVenueId?, linkedEventId?, tagUserIds?: string[]}`. Post comum precisa de um evento ou de um rolê; sem foto, precisa de texto. */
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
    return this.present(await this.core.posts.create(actor.userId, { caption: b.caption, images, placeName: b.placeName, placeAddress: b.placeAddress, placeVenueId: b.placeVenueId, linkedEventId: b.linkedEventId, tagUserIds: b.tagUserIds, event: b.event, datePollId: b.datePollId, groupId: b.groupId }));
  }

  /** Seus posts arquivados (só você vê). Vem antes de `posts/:id`. */
  @Get('posts/archived')
  async archived(@CurrentActor() actor: Actor, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const page = await this.core.posts.listArchived(actor.userId, { limit, offset });
    return { ...page, items: page.items.map((p) => this.present(p)) };
  }

  /** Posts seus e dos seus amigos. */
  @Get('posts/feed')
  /** `mixed=1`: inclui eventos de bares repostados (itens com `type: 'PLACE_EVENT'`). Sem ele, só posts, como antes. `before` (ISO): só o que veio antes dessa data. */
  async feed(@CurrentActor() actor: Actor, @Query('limit') limit?: string, @Query('offset') offset?: string, @Query('mixed') mixed?: string, @Query('before') before?: string) {
    const page = await this.core.posts.feed(actor.userId, { limit, offset, before }, { placeEvents: mixed === '1' });
    return { ...page, items: page.items.map((p) => ('type' in p ? p : this.present(p))) };
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

  /**
   * Vídeo enviado, para o <video> (que não manda o token). Aceita `Range`, que o Safari exige para tocar.
   * O id é aleatório, como o da foto.
   */
  @Public()
  @Get('posts/videos/:imageId')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Accept-Ranges', 'bytes')
  async video(@Param('imageId') imageId: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) res: { status(code: number): unknown; setHeader(name: string, value: string): unknown }) {
    const video = await this.core.posts.video(imageId);
    if (!video) throw new NotFoundException();
    const total = video.data.byteLength;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (!m || (m[1] === '' && m[2] === '')) return new StreamableFile(video.data, { type: video.mime, length: total });
    const suffix = m[1] === '';
    const start = suffix ? Math.max(0, total - Number(m[2])) : Number(m[1]);
    const end = suffix || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
    if (start >= total || start > end) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${total}`);
      return new StreamableFile(new Uint8Array(0), { type: video.mime });
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    return new StreamableFile(video.data.subarray(start, end + 1), { type: video.mime, length: end - start + 1 });
  }

  /** Configurações de evento que quem cria um evento pode responder (cadastradas pela gestão). */
  @Get('event-extras')
  async eventExtras() {
    return { items: await this.core.eventExtras.list() };
  }

  /** Gostos de rolê cadastrados pela gestão, na ordem das telas (a lista não é sigilosa: o app a carrega ao abrir). */
  @Public()
  @Get('tastes')
  async tastes() {
    return { items: await this.core.tastes.list() };
  }

  @Get('posts/:id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.present(await this.core.posts.get(actor.userId, id));
  }

  @Delete('posts/:id')
  delete(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.delete(actor.userId, id);
  }

  /** Edita legenda, lugar e evento: `{caption?, placeName?, placeAddress?, event?, inviteUserIds?}` (só o autor; `inviteUserIds` convida mais amigos para o evento). */
  @Patch('posts/:id')
  async edit(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.present(await this.core.posts.update(actor.userId, id, { caption: b.caption, placeName: b.placeName, placeAddress: b.placeAddress, placeVenueId: b.placeVenueId, linkedEventId: b.linkedEventId, event: b.event, inviteUserIds: b.inviteUserIds }));
  }

  /** Marca ou tira o "Adiado" do evento (dono ou admin): `{postponed: boolean}`. A nova data vem pela edição (que tira o adiado). */
  @Put('posts/:id/postponed')
  async setPostponed(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.present(await this.core.posts.setPostponed(actor.userId, id, asBody(body).postponed));
  }

  /** Convida mais amigos para o próprio evento: `{userIds: string[]}`, sem marcar o evento como editado. Devolve só quem foi convidado agora. */
  @Post('posts/:id/invites')
  @HttpCode(200)
  invite(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.posts.inviteToEvent(actor.userId, id, asBody(body).userIds);
  }

  /** Cancela um convite ainda não aceito: quem organiza o evento (qualquer um) ou quem mandou aquele convite. */
  @Delete('posts/:id/invites/:userId')
  cancelInvite(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('userId') userId: string) {
    return this.core.posts.cancelInvite(actor.userId, id, userId);
  }

  /** Admins do evento (sem o dono). */
  @Get('posts/:id/admins')
  eventAdmins(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.posts.listEventAdmins(actor.userId, id);
  }

  /** O dono torna admin do evento quem vai (ou aceitou o convite): `{userId}`. Devolve os admins. */
  @Post('posts/:id/admins')
  @HttpCode(200)
  addEventAdmin(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.posts.addEventAdmin(actor.userId, id, asBody(body).userId);
  }

  /** O dono tira um admin do evento; o próprio admin também pode sair. Devolve os admins. */
  @Delete('posts/:id/admins/:userId')
  removeEventAdmin(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('userId') userId: string) {
    return this.core.posts.removeEventAdmin(actor.userId, id, userId);
  }

  /** Ajuste de uma foto enviada: `{image: dataUrl}` já recortada pelo app (só o autor). */
  /** Troca a capa do próprio evento: `{image: dataUrl}` já reduzida pelo app. */
  @Put('posts/:id/cover')
  async setCover(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.present(await this.core.posts.setCover(actor.userId, id, asBody(body).image));
  }

  @Put('posts/:id/images/:imageId')
  async adjustImage(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('imageId') imageId: string, @Body() body: unknown) {
    return this.present(await this.core.posts.replaceImage(actor.userId, id, imageId, asBody(body).image));
  }

  /** Vídeo do post: o corpo é o arquivo cru (`Content-Type: video/mp4`...), no item de foto que serve de capa. */
  @Post('posts/:id/images/:imageId/video')
  @HttpCode(200)
  async attachVideo(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('imageId') imageId: string, @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    const data = Buffer.isBuffer(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
    return this.present(await this.core.posts.attachVideo(actor.userId, id, imageId, contentType, data));
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
    return this.core.posts.addComment(actor.userId, id, asBody(body).body, asBody(body).gif, asBody(body).replyTo);
  }

  @Post('posts/:id/comments/:commentId/like')
  @HttpCode(200)
  likeComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('commentId') commentId: string) {
    return this.core.posts.likeComment(actor.userId, id, commentId, true);
  }

  @Delete('posts/:id/comments/:commentId/like')
  unlikeComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('commentId') commentId: string) {
    return this.core.posts.likeComment(actor.userId, id, commentId, false);
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

  /** Denunciar um comentário. Mesmo corpo da denúncia de post. */
  @Post('posts/:id/comments/:commentId/report')
  @HttpCode(200)
  reportComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('commentId') commentId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.posts.reportComment(actor.userId, id, commentId, b.reason, b.details);
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
