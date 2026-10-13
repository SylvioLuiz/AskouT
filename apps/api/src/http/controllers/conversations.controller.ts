import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('conversations')
export class ConversationsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get()
  async list(@CurrentActor() actor: Actor) {
    return { items: await this.core.conversations.list(actor.userId) };
  }

  /** Abre (ou cria) a conversa com um amigo. */
  @Post()
  @HttpCode(200)
  open(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.conversations.open(actor.userId, asBody(body).userId);
  }

  @Get(':id/messages')
  messages(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.core.conversations.messages(actor.userId, id, { limit, before });
  }

  @Post(':id/messages')
  send(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.send(actor.userId, id, { body: b.body, suggestion: b.suggestion });
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.markRead(actor.userId, id);
  }
}
