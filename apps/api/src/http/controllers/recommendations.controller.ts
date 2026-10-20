import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/**
 * Recomendações da Home e a medição de tempo na tela que as alimenta.
 * É dado de comportamento: a pessoa pode desligar (`personalize=false`) e apagar tudo (`DELETE /me/dwell`).
 */
@Controller()
export class RecommendationsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get('me/recommendations')
  recommendations(@CurrentActor() actor: Actor, @Query('personalize') personalize?: string, @Query('limit') limit?: string) {
    return this.core.recommendations.recommend(actor.userId, {
      personalize: personalize !== 'false',
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
  }

  @Post('me/dwell')
  @HttpCode(200)
  record(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.dwell.record(actor.userId, asBody(body).items);
  }

  @Delete('me/dwell')
  erase(@CurrentActor() actor: Actor) {
    return this.core.dwell.erase(actor.userId);
  }
}
