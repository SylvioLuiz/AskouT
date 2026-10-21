import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/** Impulsionamento: quem administra o local paga para o local ou um evento aparecer em destaque (“Patrocinado”). */
@Controller()
export class BoostsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Valor por dia e opções de duração. */
  @Get('boosts/pricing')
  pricing() {
    return this.core.boosts.pricing();
  }

  @Get('me/venues/:venueId/boosts')
  list(@CurrentActor() actor: Actor, @Param('venueId') venueId: string) {
    return this.core.boosts.list(actor.userId, venueId).then((items) => ({ items }));
  }

  /** Quantas pessoas combinam hoje com um Match (só o número, arredondado; nunca quem). */
  @Get('me/venues/:venueId/boosts/estimate')
  estimate(@CurrentActor() actor: Actor, @Param('venueId') venueId: string, @Query('eventId') eventId?: string, @Query('radiusKm') radiusKm?: string, @Query('tags') tags?: string) {
    return this.core.boosts.estimate(actor.userId, venueId, {
      eventId,
      radiusKm: radiusKm === undefined ? undefined : Number(radiusKm),
      tags: (tags ?? '').split(',').filter((t) => t !== ''),
    });
  }

  /** Cria o pedido e a cobrança: `{target: 'VENUE' | 'EVENT', eventId?, days, audience?: 'ALL' | 'MATCH', radiusKm?, tags?, channel?: 'WEB' | 'APPLE' | 'GOOGLE'}`. */
  @Post('me/venues/:venueId/boosts')
  create(@CurrentActor() actor: Actor, @Param('venueId') venueId: string, @Body() body: unknown) {
    return this.core.boosts.create(actor.userId, venueId, asBody(body));
  }

  @Post('me/boosts/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.boosts.cancel(actor.userId, id);
  }

  /** Compra dentro do app: o app envia o recibo da loja `{receipt}` e o servidor confere antes de liberar. */
  @Post('me/boosts/:id/store-purchase')
  @HttpCode(200)
  storePurchase(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.boosts.confirmStorePurchase(actor.userId, id, asBody(body));
  }

  /** Só no ambiente de teste: libera o anúncio sem pagar. Fora dele responde 403. */
  @Post('me/boosts/:id/simulate-payment')
  @HttpCode(200)
  simulate(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.boosts.simulatePayment(actor.userId, id);
  }

  /** Aviso do provedor de pagamento. Sem login: quem garante que é verdadeiro é a assinatura, conferida pelo provedor. */
  @Public()
  @Post('payments/webhook')
  @HttpCode(200)
  async webhook(@Headers() headers: Record<string, string | undefined>, @Req() req: { rawBody?: Buffer }, @Body() body: unknown) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
    await this.core.boosts.handleWebhook(headers, raw);
    // Sempre 200: o provedor não precisa saber se o aviso valeu (e não repete à toa).
    return { ok: true };
  }
}
