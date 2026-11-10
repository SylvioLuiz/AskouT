import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import { CORE } from '../tokens.ts';

/** Busca de GIFs para os comentários. A chave da Giphy fica no servidor; sem ela `enabled` é falso e o app esconde o botão. */
@Controller()
export class GifsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Mais populares (sem `q`) ou busca. Resposta: `{ enabled, items, nextOffset }`. */
  @Get('gifs')
  search(@Query() query: Record<string, unknown>) {
    return this.core.gifs.search({ q: query.q, limit: query.limit, offset: query.offset, lang: query.lang });
  }

  /** Só para o app saber se mostra o botão de GIF. */
  @Get('gifs/status')
  status() {
    return { enabled: this.core.gifs.enabled };
  }
}
