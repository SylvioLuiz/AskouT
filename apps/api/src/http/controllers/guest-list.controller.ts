import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Lista VIP (nome na lista) dos eventos de locais. Sem pagamento. */
@Controller()
export class GuestListController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** O que quem abre o evento vê: ligada?, vagas, horário de fechamento e o meu nome. */
  @Get('events/:id/guest-list')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.guestList.get(actor.userId, id);
  }

  /** `{companions?}`: põe meu nome na lista (ou muda os acompanhantes). */
  @Post('events/:id/guest-list/join')
  @HttpCode(200)
  join(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.guestList.join(actor.userId, id, { companions: asBody(body).companions });
  }

  @Delete('events/:id/guest-list/join')
  leave(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.guestList.leave(actor.userId, id);
  }

  /** Só quem administra o local. `{enabled, limit?, closesAt?, maxCompanions?}` */
  @Put('events/:id/guest-list')
  configure(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.guestList.configure(actor.userId, id, { enabled: b.enabled, limit: b.limit, closesAt: b.closesAt, maxCompanions: b.maxCompanions });
  }

  /** Só quem administra o local: nome, @usuário, acompanhantes e quem já entrou. */
  @Get('events/:id/guest-list/entries')
  @Header('Cache-Control', 'private, no-store')
  entries(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.guestList.entries(actor.userId, id);
  }

  /** `{checkedIn: boolean}` */
  @Put('events/:id/guest-list/entries/:userId/check-in')
  checkIn(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('userId') userId: string, @Body() body: unknown) {
    return this.core.guestList.checkIn(actor.userId, id, userId, asBody(body).checkedIn);
  }

  /** `{filename, csv}`: o app salva como arquivo. */
  @Get('events/:id/guest-list/export')
  @Header('Cache-Control', 'private, no-store')
  export(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.guestList.exportCsv(actor.userId, id);
  }
}
