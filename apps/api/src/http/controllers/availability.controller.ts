import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/**
 * A agenda é privada: só a própria pessoa lê e grava os horários dela. Não há rota para ver a agenda de outra pessoa nem para comparar agendas.
 * Datas e horas em query string precisam vir codificadas na URL ("+" de um fuso positivo vira espaço);
 * por isso os clientes mandam em UTC ("...Z"), que não tem esse problema.
 */
@Controller()
export class AvailabilityController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get('me/availability')
  listMine(@CurrentActor() actor: Actor, @Query('from') from: unknown, @Query('to') to: unknown) {
    return this.core.availability.listMine(actor.userId, from, to);
  }

  @Post('me/availability')
  addSlot(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.availability.addSlot(actor.userId, { start: b.start, end: b.end, state: b.state });
  }

  @Delete('me/availability/:slotId')
  removeSlot(@CurrentActor() actor: Actor, @Param('slotId', new ParseUUIDPipe()) slotId: string) {
    return this.core.availability.removeSlot(actor.userId, slotId);
  }
}
