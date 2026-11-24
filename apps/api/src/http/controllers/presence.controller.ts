import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Bolinha verde de online. O app chama `GET /presence/online` a cada 30 s com a tela aberta: é o sinal de que está online. */
@Controller('presence')
export class PresenceController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** `{userIds}`: amigos e pessoas com conversa liberada que estão online agora. Também marca quem pergunta como online. */
  @Get('online')
  async online(@CurrentActor() actor: Actor) {
    return { userIds: await this.core.presence.heartbeat(actor.userId) };
  }

  /** O app saiu da tela (foi para segundo plano): a bolinha some na hora. */
  @Post('away')
  @HttpCode(204)
  away(@CurrentActor() actor: Actor): void {
    this.core.presence.leave(actor.userId);
  }

  /** `{showOnline}` */
  @Get('settings')
  settings(@CurrentActor() actor: Actor) {
    return this.core.presence.settings(actor.userId);
  }

  @Put('settings')
  setSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.presence.setSettings(actor.userId, { showOnline: asBody(body).showOnline });
  }
}
