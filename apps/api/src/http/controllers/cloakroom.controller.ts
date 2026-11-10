import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Chapelaria do evento: painel e conferência de quem organiza, e ticket de quem participa. */
@Controller()
export class CloakroomController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Tickets da pessoa em todos os eventos. */
  @Get('me/cloakroom')
  mine(@CurrentActor() actor: Actor) {
    return this.core.cloakroom.mine(actor.userId);
  }

  /** O que a pessoa vê no evento: se há chapelaria, preço, vagas e os próprios tickets. */
  @Get('events/:id/cloakroom')
  view(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.cloakroom.publicView(actor.userId, id);
  }

  /** `{description, itemCount}`: pede um ticket. */
  @Post('events/:id/cloakroom/tickets')
  request(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.cloakroom.request(actor.userId, id, { description: b.description, itemCount: b.itemCount });
  }

  /** Desiste do ticket antes de entregar os itens. */
  @Delete('cloakroom/tickets/:ticketId')
  cancel(@CurrentActor() actor: Actor, @Param('ticketId') ticketId: string) {
    return this.core.cloakroom.cancel(actor.userId, ticketId);
  }

  /** Painel de quem organiza: configuração, números e tickets. */
  @Get('me/venues/:id/events/:eventId/cloakroom')
  panel(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string) {
    return this.core.cloakroom.panel(actor.userId, id, eventId);
  }

  /** `{enabled, priceCents?, capacity?, note?}` */
  @Put('me/venues/:id/events/:eventId/cloakroom')
  configure(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.cloakroom.configure(actor.userId, id, eventId, { enabled: b.enabled, priceCents: b.priceCents, capacity: b.capacity, note: b.note });
  }

  /** `{code}`: consulta o ticket sem mudar nada. */
  @Post('me/venues/:id/events/:eventId/cloakroom/lookup')
  @HttpCode(200)
  lookup(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.core.cloakroom.lookup(actor.userId, id, eventId, asBody(body).code);
  }

  /** `{code}`: itens recebidos e guardados. */
  @Post('me/venues/:id/events/:eventId/cloakroom/receive')
  @HttpCode(200)
  receive(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.core.cloakroom.receive(actor.userId, id, eventId, asBody(body).code);
  }

  /** `{code}`: itens devolvidos. */
  @Post('me/venues/:id/events/:eventId/cloakroom/return')
  @HttpCode(200)
  giveBack(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('eventId') eventId: string, @Body() body: unknown) {
    return this.core.cloakroom.giveBack(actor.userId, id, eventId, asBody(body).code);
  }
}
