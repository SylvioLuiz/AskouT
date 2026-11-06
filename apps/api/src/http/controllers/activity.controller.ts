import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/** Registro de atividades da própria pessoa (tela "Suas interações"). */
@Controller()
export class ActivityController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** `kind`: ALL, LIKE, COMMENT, POST, FOLLOW ou EVENT. `cursor`: o `nextCursor` da página anterior. */
  @Get('me/activity')
  list(@CurrentActor() actor: Actor, @Query('kind') kind?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.core.activity.list(actor.userId, {
      ...(typeof kind === 'string' && kind ? { kind } : {}),
      ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
      ...(typeof limit === 'string' && limit ? { limit: Number(limit) } : {}),
    });
  }
}
