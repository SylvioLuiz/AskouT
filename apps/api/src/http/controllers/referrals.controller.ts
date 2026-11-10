import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller()
export class ReferralsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Depois do cadastro pelo link de convite: registra quem convidou (uma vez só; convite inválido é ignorado). */
  @Post('me/referral')
  @HttpCode(200)
  claim(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.referrals.claim(actor, asBody(body).inviter);
  }

  /** "Você trouxe N amigos": contagem, progresso do selo e quem entrou. */
  @Get('me/referrals')
  overview(@CurrentActor() actor: Actor) {
    return this.core.referrals.overview(actor);
  }

  /** Esconde ou mostra o selo no próprio perfil. */
  @Put('me/referral-badge')
  setBadge(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.referrals.setBadgeHidden(actor, asBody(body).hidden);
  }
}
