import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { CORE } from '../tokens.ts';

/**
 * Dados dos widgets do celular (tela inicial e tela bloqueada, iPhone e Android). Quem chama é o próprio widget,
 * com o token que o app guardou para ele (Keychain compartilhado no iPhone, armazenamento do app no Android).
 */
@Controller()
export class WidgetsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get('me/widgets')
  snapshot(@CurrentActor() actor: Actor) {
    return this.core.widgets.snapshot(actor.userId);
  }

  /** Widget de conversas: `show` = all (padrão), direct (só 1 a 1) ou group (só grupos). */
  @Get('me/widgets/chats')
  chats(@CurrentActor() actor: Actor, @Query('show') show?: string) {
    return this.core.widgets.chats(actor.userId, show);
  }
}
