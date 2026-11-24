import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { networkKey } from '../support/network-key.ts';
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

  /**
   * Página do convite no celular sem o app, logo antes de ir para a loja: guarda quem convidou pela rede de quem tocou
   * (hash do IP). Assim o convite sobrevive à instalação e é sugerido no cadastro pelo app.
   */
  @Public()
  @Post('referrals/click')
  @HttpCode(200)
  click(@Req() req: { ip?: string }, @Body() body: unknown) {
    return this.core.referrals.recordClick(networkKey(req.ip), asBody(body).inviter);
  }

  /** Logo depois do cadastro pelo app, sem convite junto: quem tocou no link de convite pela mesma rede (a pessoa confirma). */
  @Get('me/referral/pending')
  pending(@CurrentActor() actor: Actor, @Req() req: { ip?: string }) {
    return this.core.referrals.pending(actor, networkKey(req.ip));
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
