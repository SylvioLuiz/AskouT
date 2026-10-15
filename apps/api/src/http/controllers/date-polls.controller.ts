import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** "Encontrar a melhor data": votação de disponibilidade, ranking e confirmação. */
@Controller('date-polls')
export class DatePollsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Votações abertas em que você participa. */
  @Get()
  mine(@CurrentActor() actor: Actor) {
    return this.core.scheduling.listMine(actor.userId);
  }

  /** Abre a votação numa conversa: `{conversationId, title, rangeStart, rangeEnd, ...}`. */
  @Post()
  @HttpCode(200)
  create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.scheduling.create(actor.userId, b.conversationId, b);
  }

  /** Votações de uma conversa. */
  @Get('conversation/:conversationId')
  forConversation(@CurrentActor() actor: Actor, @Param('conversationId', new ParseUUIDPipe()) conversationId: string) {
    return this.core.scheduling.listForConversation(actor.userId, conversationId);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.scheduling.get(actor.userId, id);
  }

  /** Marca dias: `{status: 'YES'|'MAYBE'|'NO'|'CLEAR', dates: ['AAAA-MM-DD']}`. */
  @Post(':id/votes')
  @HttpCode(200)
  vote(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.scheduling.vote(actor.userId, id, { status: b.status, dates: b.dates });
  }

  /** `{finished: boolean}`: concluí (ou reabro) a minha votação. */
  @Post(':id/finish')
  @HttpCode(200)
  finish(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.scheduling.finish(actor.userId, id, asBody(body).finished);
  }

  /** Quem organiza manda uma data para confirmação: `{date}`. */
  @Post(':id/propose')
  @HttpCode(200)
  propose(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.scheduling.propose(actor.userId, id, asBody(body).date);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.scheduling.withdraw(actor.userId, id);
  }

  /** `{status: 'CONFIRMED'|'ADJUST'|'DECLINED'}`. */
  @Post(':id/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.scheduling.respond(actor.userId, id, asBody(body).status);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  finalize(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.scheduling.finalizeManual(actor.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.scheduling.cancel(actor.userId, id);
  }
}
