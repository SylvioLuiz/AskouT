import { Body, Controller, Delete, Get, Inject, Put } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/**
 * "Minha região" (opcional): onde a pessoa mora, aproximado a ~1 km, para receber anúncios Match.
 * Dado de localização (LGPD): só existe se a pessoa der, e `DELETE` apaga.
 */
@Controller()
export class RegionController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get('me/region')
  get(@CurrentActor() actor: Actor) {
    return this.core.regions.get(actor.userId);
  }

  @Put('me/region')
  set(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.regions.set(actor.userId, asBody(body));
  }

  @Delete('me/region')
  clear(@CurrentActor() actor: Actor) {
    return this.core.regions.clear(actor.userId);
  }
}
