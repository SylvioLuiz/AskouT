import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
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

  /** Eventos que ainda vão acontecer nos locais que você segue (feed). */
  @Get('explore/followed-events')
  async followedEvents(@CurrentActor() actor: Actor) {
    return this.core.explore.followedEvents(actor.userId);
  }

  /** Anúncios da Home (eventos impulsionados). Sempre marcados como patrocinados. */
  @Get('explore/sponsored')
  sponsored(@CurrentActor() actor: Actor) {
    return this.core.explore.sponsored(actor.userId);
  }

  /** Motor de inteligência social: eventos que o grupo (você e os amigos escolhidos) deve curtir, em data que dá para todos. Só lê. */
  @Post('explore/group-match')
  @HttpCode(200)
  groupMatch(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.groupMatch.suggest(actor.userId, { friendIds: b.friendIds, days: b.days, limit: b.limit });
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

  /** Stories no ar do evento, agrupados por pessoa. */
  @Get('events/:id/stories')
  stories(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.eventPages.stories(actor.userId, id).then((groups) => ({ groups }));
  }

  /** Publica um story: o corpo é o arquivo cru (`Content-Type: image/jpeg`, `video/mp4`...). */
  @Post('events/:id/stories')
  @HttpCode(200)
  async createStory(@CurrentActor() actor: Actor, @Param('id') id: string, @Headers('content-type') contentType: string | undefined, @Body() body: unknown) {
    const data = Buffer.isBuffer(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
    return this.core.eventPages.createStory(actor.userId, id, contentType, data);
  }

  @Delete('events/:id/stories/:storyId')
  deleteStory(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('storyId') storyId: string) {
    return this.core.eventPages.deleteStory(actor.userId, id, storyId);
  }

  @Post('events/:id/stories/:storyId/report')
  @HttpCode(200)
  reportStory(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('storyId') storyId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.eventPages.reportStory(actor.userId, id, storyId, b.reason, b.details);
  }

  /** Foto ou vídeo do story (com Range para o vídeo). O id é aleatório; some quando o story acaba. */
  @Public()
  @Get('stories/media/:storyId')
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Accept-Ranges', 'bytes')
  async storyMedia(@Param('storyId') storyId: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) res: { status(code: number): unknown; setHeader(name: string, value: string): unknown }) {
    const media = await this.core.eventPages.storyMedia(storyId);
    if (!media) throw new NotFoundException();
    const total = media.data.byteLength;
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (!m || (m[1] === '' && m[2] === '')) return new StreamableFile(media.data, { type: media.mime, length: total });
    const suffix = m[1] === '';
    const start = suffix ? Math.max(0, total - Number(m[2])) : Number(m[1]);
    const end = suffix || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
    if (start >= total || start > end) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${total}`);
      return new StreamableFile(new Uint8Array(0), { type: media.mime });
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    return new StreamableFile(media.data.subarray(start, end + 1), { type: media.mime, length: end - start + 1 });
  }

  /** Eventos em que você confirmou presença e que ainda não acabaram (alimenta a agenda). */
  @Get('me/events/going')
  async myGoing(@CurrentActor() actor: Actor) {
    return { items: await this.core.eventPages.listMyGoing(actor.userId) };
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
