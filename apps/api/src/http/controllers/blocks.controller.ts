import { Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE } from '../tokens.ts';

@Controller()
export class BlocksController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Post('users/:userId/block')
  @HttpCode(200)
  async block(@CurrentActor() actor: Actor, @Param('userId', new ParseUUIDPipe()) userId: string) {
    await this.core.blocks.block(actor.userId, userId);
    return { ok: true };
  }

  @Delete('users/:userId/block')
  unblock(@CurrentActor() actor: Actor, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.core.blocks.unblock(actor.userId, userId);
  }

  @Get('me/blocks')
  list(@CurrentActor() actor: Actor) {
    return this.core.blocks.list(actor.userId);
  }
}
