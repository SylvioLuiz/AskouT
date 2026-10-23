import { Body, Controller, Delete, Get, Header, HttpCode, Inject } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Direitos do titular (LGPD): cópia dos dados e exclusão da conta. */
@Controller()
export class AccountController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Cópia dos seus dados em JSON. */
  @Get('me/export')
  @Header('Cache-Control', 'no-store')
  async exportData(@CurrentActor() actor: Actor) {
    return this.core.account.exportData(actor.userId);
  }

  /** Apaga a conta de vez. Corpo: `{username, password}` (conta que entra com Google/Apple não envia senha). */
  @Delete('me')
  @HttpCode(200)
  deleteAccount(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.account.deleteAccount(actor.userId, { username: b.username, password: b.password });
  }
}
