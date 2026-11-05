import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type { PlacePhotos } from './places.controller.ts';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE, PLACE_PHOTOS } from '../tokens.ts';

@Controller()
export class FlashController {
  private readonly core: Core;
  private readonly photos: PlacePhotos;

  constructor(@Inject(CORE) core: Core, @Inject(PLACE_PHOTOS) photos: PlacePhotos) {
    this.core = core;
    this.photos = photos;
  }

  @Get('me/flash')
  status(@CurrentActor() actor: Actor) {
    return this.core.flash.status(actor.userId);
  }

  @Post('me/flash')
  @HttpCode(200)
  turnOn(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.flash.turnOn(actor.userId, { hours: b.hours, minutes: b.minutes, note: b.note, lat: b.lat, lng: b.lng });
  }

  /** Estende o NOW ligado: `{minutes: 30 | 60}`. */
  @Post('me/flash/extend')
  @HttpCode(200)
  extend(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.flash.extend(actor.userId, { minutes: asBody(body).minutes });
  }

  @Delete('me/flash')
  turnOff(@CurrentActor() actor: Actor) {
    return this.core.flash.turnOff(actor.userId);
  }

  @Get('flash/available')
  /** `?ordem=perto` (padrão quando ligou com localização) ou `?ordem=interacao`. */
  async available(@CurrentActor() actor: Actor, @Query('ordem') ordem?: string) {
    return this.core.flash.listAvailableRanked(actor.userId, ordem === 'perto' ? 'near' : ordem === 'interacao' ? 'interaction' : undefined);
  }

  @Get('flash/active')
  async active(@CurrentActor() actor: Actor) {
    return { userIds: await this.core.flash.activeIds(actor.userId) };
  }

  @Get('flash/visibility/:userId')
  visibility(@CurrentActor() actor: Actor, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.core.flash.visibility(actor.userId, userId);
  }

  @Put('flash/visibility/:userId')
  setVisibility(@CurrentActor() actor: Actor, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.flash.setVisibility(actor.userId, userId, { hideTheirs: b.hideTheirs, hideMine: b.hideMine });
  }

  @Get('flash/invites')
  invites(@CurrentActor() actor: Actor) {
    return this.core.flash.listInvites(actor.userId);
  }

  @Post('flash/invites')
  invite(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.flash.invite(actor.userId, typeof b.userId === 'string' ? b.userId : '');
  }

  @Post('flash/invites/:inviteId/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string, @Body() body: unknown) {
    return this.core.flash.respond(actor.userId, inviteId, asBody(body).action);
  }

  @Delete('flash/invites/:inviteId')
  end(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string) {
    return this.core.flash.end(actor.userId, inviteId);
  }

  @Get('flash/matches/:inviteId')
  match(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string) {
    return this.core.flash.getMatch(actor.userId, inviteId);
  }

  @Get('flash/matches/:inviteId/suggestions')
  async suggestions(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string) {
    const view = await this.core.suggestions.forMatch(actor.userId, inviteId);
    // A referência da foto não sai da API: o app recebe um endereço assinado e com validade.
    return {
      ...view,
      items: view.items.map(({ photoRef, ...item }) => ({ ...item, photoPath: photoRef && this.photos.google ? this.photos.signer.path(photoRef) : null })),
    };
  }

  /** Um dos dois escolhe o lugar do encontro: `{name, lat, lng}`. */
  @Put('flash/matches/:inviteId/destination')
  chooseDestination(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.flash.chooseDestination(actor.userId, inviteId, { name: b.name, lat: b.lat, lng: b.lng });
  }

  @Delete('flash/matches/:inviteId/destination')
  clearDestination(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string) {
    return this.core.flash.clearDestination(actor.userId, inviteId);
  }

  /** Rota de cada um até o lugar escolhido. `?modo=carro` para de carro; o padrão é a pé. */
  @Get('flash/matches/:inviteId/routes')
  routes(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string, @Query('modo') modo?: string) {
    return this.core.flash.routes(actor.userId, inviteId, modo === 'carro' ? 'driving' : 'foot');
  }

  @Put('flash/matches/:inviteId/location')
  shareLocation(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.flash.shareLocation(actor.userId, inviteId, { lat: b.lat, lng: b.lng, accuracyM: b.accuracyM });
  }
}
