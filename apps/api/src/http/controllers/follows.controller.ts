import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { parseIntParam } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class FollowsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Post('users/:userId/follow')
  @HttpCode(200)
  follow(@CurrentActor() actor: Actor, @Param('userId', uuid()) userId: string) {
    return this.core.follows.follow(actor.userId, userId);
  }

  @Delete('users/:userId/follow')
  unfollow(@CurrentActor() actor: Actor, @Param('userId', uuid()) userId: string) {
    return this.core.follows.unfollow(actor.userId, userId);
  }

  @Get('users/:userId/followers')
  followers(
    @CurrentActor() actor: Actor,
    @Param('userId', uuid()) userId: string,
    @Query('limit') limit: unknown,
    @Query('offset') offset: unknown,
  ) {
    return this.core.follows.listFollowers(actor.userId, userId, { limit: parseIntParam(limit), offset: parseIntParam(offset) });
  }

  @Get('users/:userId/following')
  following(
    @CurrentActor() actor: Actor,
    @Param('userId', uuid()) userId: string,
    @Query('limit') limit: unknown,
    @Query('offset') offset: unknown,
  ) {
    return this.core.follows.listFollowing(actor.userId, userId, { limit: parseIntParam(limit), offset: parseIntParam(offset) });
  }

  @Get('me/follow-requests')
  requests(@CurrentActor() actor: Actor, @Query('limit') limit: unknown, @Query('offset') offset: unknown) {
    return this.core.follows.listPendingRequests(actor.userId, { limit: parseIntParam(limit), offset: parseIntParam(offset) });
  }

  @Post('me/follow-requests/:userId/approve')
  @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('userId', uuid()) userId: string) {
    return this.core.follows.approve(actor.userId, userId);
  }

  @Post('me/follow-requests/:userId/reject')
  @HttpCode(200)
  async reject(@CurrentActor() actor: Actor, @Param('userId', uuid()) userId: string) {
    await this.core.follows.reject(actor.userId, userId);
    return { ok: true };
  }

  @Delete('me/followers/:userId')
  async removeFollower(@CurrentActor() actor: Actor, @Param('userId', uuid()) userId: string) {
    await this.core.follows.removeFollower(actor.userId, userId);
    return { ok: true };
  }

  /** `{hashes: string[]}`: SHA-256 (hex) dos e-mails dos contatos, só do aparelho. */
  @Post('me/contact-matches')
  @HttpCode(200)
  contactMatches(@CurrentActor() actor: Actor, @Body() body: { hashes?: unknown }) {
    return this.core.follows.contactMatches(actor.userId, body?.hashes);
  }

  @Get('me/suggested-people')
  suggestedPeople(@CurrentActor() actor: Actor) {
    return this.core.follows.suggestedPeople(actor.userId);
  }

  @Get('me/friends')
  friends(@CurrentActor() actor: Actor) {
    return this.core.follows.listFriends(actor.userId);
  }
}
