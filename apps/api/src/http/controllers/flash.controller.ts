import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
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
    return this.core.flash.turnOn(actor.userId, { hours: b.hours, minutes: b.minutes, note: b.note });
  }

  @Delete('me/flash')
  turnOff(@CurrentActor() actor: Actor) {
    return this.core.flash.turnOff(actor.userId);
  }

  @Get('flash/available')
  async available(@CurrentActor() actor: Actor) {
    return { items: await this.core.flash.listAvailable(actor.userId) };
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

  @Put('flash/matches/:inviteId/location')
  shareLocation(@CurrentActor() actor: Actor, @Param('inviteId', new ParseUUIDPipe()) inviteId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.flash.shareLocation(actor.userId, inviteId, { lat: b.lat, lng: b.lng, accuracyM: b.accuracyM });
  }
}
