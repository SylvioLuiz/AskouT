import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/** Painel do local (dentro do perfil): reivindicar um local e cuidar dos eventos dele. */
@Controller()
export class VenuesController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Meus locais e meus pedidos de reivindicação. */
  @Get('me/venues')
  mine(@CurrentActor() actor: Actor) {
    return this.core.venues.mine(actor.userId);
  }

  /** Busca locais pelo nome para reivindicar. */
  @Get('venues/claimable')
  claimable(@CurrentActor() actor: Actor, @Query('q') q: unknown) {
    return this.core.venues.searchClaimable(actor.userId, q);
  }

  /** `{document: dataUrl, note?}` */
  @Post('venues/:id/claims')
  @HttpCode(200)
  claim(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.venues.requestClaim(actor.userId, id, { document: b.document, note: b.note });
  }

  @Delete('venue-claims/:id')
  cancelClaim(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.cancelClaim(actor.userId, id);
  }

  @Get('me/venues/:id')
  panel(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.venues.panel(actor.userId, id);
  }

  @Post('me/venues/:id/events')
  @HttpCode(200)
  createEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.venues.createEvent(actor.userId, id, asBody(body));
  }

  @Put('me/venues/:id/events/:eventId')
  updateEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.core.venues.updateEvent(actor.userId, id, eventId, asBody(body));
  }

  @Delete('me/venues/:id/events/:eventId')
  deleteEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string) {
    return this.core.venues.deleteEvent(actor.userId, id, eventId);
  }
}
