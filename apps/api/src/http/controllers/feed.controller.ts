import { Body, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { FeedPageView, FeedPlace, FeedPostView } from '../../core/feed-service.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/** Feed das páginas de evento e de rolê: publicações, aprovação, reações e comentários com @menções. */
@Controller()
export class FeedController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Publicadas, da mais nova para a mais antiga. `?cursor=` (o `nextCursor` da página anterior) e `?limit=`. */
  @Get('events/:id/feed')
  eventFeed(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.list(actor, 'event', id, query);
  }

  @Get('venues/:id/feed')
  venueFeed(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.list(actor, 'venue', id, query);
  }

  /** `{kind?: 'POST'|'NOTICE', body?, images?: dataUrl[]}` */
  @Post('events/:id/feed')
  @HttpCode(200)
  createInEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.create(actor, 'event', id, body);
  }

  @Post('venues/:id/feed')
  @HttpCode(200)
  createInVenue(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.create(actor, 'venue', id, body);
  }

  /** `{policy: 'OPEN'|'MODERATED'|'OWNER_ONLY'}`. Só quem organiza. */
  @Put('events/:id/feed/policy')
  eventPolicy(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.feed.setPolicy(actor.userId, 'event', id, asBody(body).policy);
  }

  @Put('venues/:id/feed/policy')
  venuePolicy(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.feed.setPolicy(actor.userId, 'venue', id, asBody(body).policy);
  }

  /** Só quem organiza: as publicações esperando aprovação. */
  @Get('events/:id/feed/pending')
  eventPending(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.pending(actor, 'event', id);
  }

  @Get('venues/:id/feed/pending')
  venuePending(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.pending(actor, 'venue', id);
  }

  private async list(actor: Actor, place: FeedPlace, id: string, query: Record<string, unknown>) {
    return FeedController.presentPage(await this.core.feed.list(actor.userId, place, id, { cursor: query.cursor, limit: query.limit }));
  }

  private async create(actor: Actor, place: FeedPlace, id: string, body: unknown) {
    const b = asBody(body);
    return FeedController.presentPost(await this.core.feed.create(actor.userId, place, id, { kind: b.kind, body: b.body, images: b.images }));
  }

  private async pending(actor: Actor, place: FeedPlace, id: string) {
    const { items } = await this.core.feed.pending(actor.userId, place, id);
    return { items: items.map(FeedController.presentPost) };
  }

  @Get('feed/posts/:postId')
  async get(@CurrentActor() actor: Actor, @Param('postId') postId: string) {
    return FeedController.presentPost(await this.core.feed.get(actor.userId, postId));
  }

  @Delete('feed/posts/:postId')
  remove(@CurrentActor() actor: Actor, @Param('postId') postId: string) {
    return this.core.feed.remove(actor.userId, postId);
  }

  @Post('feed/posts/:postId/approve')
  @HttpCode(200)
  async approve(@CurrentActor() actor: Actor, @Param('postId') postId: string) {
    return FeedController.presentPost(await this.core.feed.approve(actor.userId, postId));
  }

  @Post('feed/posts/:postId/reject')
  @HttpCode(200)
  reject(@CurrentActor() actor: Actor, @Param('postId') postId: string) {
    return this.core.feed.reject(actor.userId, postId);
  }

  /** `{emoji}`; `{emoji: null}` tira a reação. */
  @Put('feed/posts/:postId/reaction')
  react(@CurrentActor() actor: Actor, @Param('postId') postId: string, @Body() body: unknown) {
    return this.core.feed.react(actor.userId, postId, asBody(body).emoji ?? null);
  }

  @Get('feed/posts/:postId/comments')
  comments(@CurrentActor() actor: Actor, @Param('postId') postId: string, @Query() query: Record<string, unknown>) {
    return this.core.feed.comments(actor.userId, postId, { cursor: query.cursor, limit: query.limit });
  }

  /** `{body}`, com @usuario para mencionar. */
  @Post('feed/posts/:postId/comments')
  @HttpCode(200)
  addComment(@CurrentActor() actor: Actor, @Param('postId') postId: string, @Body() body: unknown) {
    return this.core.feed.addComment(actor.userId, postId, asBody(body).body);
  }

  @Delete('feed/comments/:commentId')
  deleteComment(@CurrentActor() actor: Actor, @Param('commentId') commentId: string) {
    return this.core.feed.deleteComment(actor.userId, commentId);
  }

  @Put('feed/comments/:commentId/reaction')
  reactComment(@CurrentActor() actor: Actor, @Param('commentId') commentId: string, @Body() body: unknown) {
    return this.core.feed.reactComment(actor.userId, commentId, asBody(body).emoji ?? null);
  }

  /** Foto de uma publicação, para o <img> (que não manda o token). O id é aleatório, como nas fotos dos posts. */
  @Public()
  @Get('feed/images/:imageId')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(@Param('imageId') imageId: string) {
    const photo = await this.core.feed.image(imageId);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }

  private static presentPost(post: FeedPostView) {
    const { imageIds, ...rest } = post;
    return { ...rest, images: imageIds.map((id) => ({ id, path: `/feed/images/${id}` })) };
  }

  private static presentPage(page: FeedPageView) {
    return { ...page, items: page.items.map(FeedController.presentPost), myPending: page.myPending.map(FeedController.presentPost) };
  }
}
