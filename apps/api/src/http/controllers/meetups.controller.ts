import { Body, Controller, Get, Patch, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('meetups')
export class MeetupsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Cria um encontro a partir de um evento: `{eventId, guestIds, name?}`. Vários convidados criam um grupo. */
  @Post()
  @HttpCode(200)
  create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.meetups.create(actor.userId, { eventId: b.eventId, guestIds: b.guestIds, name: b.name });
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.meetups.get(actor.userId, id);
  }

  /** O convidado aceita ou recusa (`{action: 'accept' | 'decline'}`). Aceitar num grupo coloca a pessoa nele. */
  @Post(':id/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.meetups.respond(actor.userId, id, asBody(body).action);
  }

  /** Convida mais amigos para um encontro de grupo: `{guestIds}`. */
  @Post(':id/invite')
  @HttpCode(200)
  invite(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.meetups.invite(actor.userId, id, asBody(body).guestIds);
  }

  /** Quem organiza muda o nome: `{title}`. */
  @Patch(':id')
  rename(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.meetups.rename(actor.userId, id, asBody(body).title);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.meetups.cancel(actor.userId, id);
  }
}
