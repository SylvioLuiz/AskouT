import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { asBody } from '../support/parse.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/** Oferta relâmpago: quem administra o local publica; quem está perto (NOW ou região salva) vê como “Patrocinado”. */
@Controller()
export class OffersController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** A oferta que vale para mim agora (no máximo uma). Sem nada sobre quem mais recebeu. */
  @Get('offers/nearby')
  async nearby(@CurrentActor() actor: Actor) {
    return { items: await this.core.offers.forViewer(actor.userId, new Date()) };
  }

  /** Ofertas do local, a faixa de alcance da que está no ar, os limites e quantas ainda dá para publicar hoje. */
  @Get('me/venues/:venueId/offers')
  list(@CurrentActor() actor: Actor, @Param('venueId') venueId: string) {
    return this.core.offers.list(actor.userId, venueId);
  }

  /** Publica: `{text, minutes}`. */
  @Post('me/venues/:venueId/offers')
  create(@CurrentActor() actor: Actor, @Param('venueId') venueId: string, @Body() body: unknown) {
    return this.core.offers.create(actor.userId, venueId, asBody(body));
  }

  @Post('me/offers/:id/end')
  @HttpCode(200)
  end(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.offers.end(actor.userId, id);
  }
}
