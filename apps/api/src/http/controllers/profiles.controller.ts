import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody, parseIntParam } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('profiles')
export class ProfilesController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  // As rotas fixas (search, me) vêm antes de ":username" para não serem capturadas por ele.
  @Get('search')
  search(@CurrentActor() actor: Actor, @Query('q') q: unknown, @Query('limit') limit: unknown) {
    return this.core.profiles.search(actor.userId, q, parseIntParam(limit));
  }

  @Patch('me')
  @HttpCode(200)
  updateOwn(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.profiles.updateOwn(actor.userId, { displayName: b.displayName, bio: b.bio, avatarUrl: b.avatarUrl });
  }

  @Patch('me/privacy')
  @HttpCode(200)
  setPrivacy(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.profiles.setPrivacy(actor.userId, asBody(body).isPrivate);
  }

  @Get(':username')
  getByUsername(@CurrentActor() actor: Actor, @Param('username') username: string) {
    return this.core.profiles.getByUsername(actor.userId, username);
  }
}
