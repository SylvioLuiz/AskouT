import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/**
 * A agenda é privada até a pessoa ligar "mostrar meus horários para amigos" (`PUT me/availability/sharing`).
 * Ligado, os amigos dela veem os horários e acham horários em comum; quem não ligou nunca aparece.
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

  @Get('me/availability/sharing')
  sharing(@CurrentActor() actor: Actor) {
    return this.core.availability.sharing(actor.userId);
  }

  @Put('me/availability/sharing')
  setSharing(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.availability.setSharing(actor.userId, asBody(body).sharing);
  }

  /** Amigos que mostram os horários. */
  @Get('friends/availability')
  sharingFriends(@CurrentActor() actor: Actor) {
    return this.core.availability.sharingFriends(actor.userId);
  }

  @Get('friends/:friendId/availability')
  friend(@CurrentActor() actor: Actor, @Param('friendId', new ParseUUIDPipe()) friendId: string, @Query('from') from: unknown, @Query('to') to: unknown) {
    return this.core.availability.listFriend(actor.userId, friendId, from, to);
  }

  /** Horários em comum: o melhor horário de cada dia para você e os amigos escolhidos. */
  @Post('availability/best-dates')
  @HttpCode(200)
  bestDates(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.availability.bestDates(actor.userId, { friendIds: b.friendIds, fromDate: b.fromDate, toDate: b.toDate, durationMinutes: b.durationMinutes, earliestStart: b.earliestStart, latestStart: b.latestStart, timeZone: b.timeZone, limit: b.limit });
  }

  @Delete('me/availability/:slotId')
  removeSlot(@CurrentActor() actor: Actor, @Param('slotId', new ParseUUIDPipe()) slotId: string) {
    return this.core.availability.removeSlot(actor.userId, slotId);
  }
}
