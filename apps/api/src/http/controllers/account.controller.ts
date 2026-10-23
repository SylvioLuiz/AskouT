import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Post, Put } from '@nestjs/common';
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

  /** Se a pessoa já informou a data de nascimento e se tem 18 anos ou mais (libera o Flash). */
  @Get('me/age')
  ageStatus(@CurrentActor() actor: Actor) {
    return this.core.age.status(actor.userId);
  }

  /** Corrige a data de nascimento. Não vale para quem consta como menor de 18 anos. */
  @Put('me/age')
  correctAge(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.age.correct(actor.userId, { birthDate: b.birthDate });
  }

  /** Versão dos Termos que a pessoa aceitou e se é a atual. */
  @Get('me/terms')
  termsStatus(@CurrentActor() actor: Actor) {
    return this.core.age.termsStatus(actor.userId);
  }

  /** `{version}`: aceita a versão atual dos Termos. */
  @Post('me/terms')
  @HttpCode(200)
  acceptTerms(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.age.acceptTerms(actor.userId, { version: asBody(body).version });
  }

  /** Informa a data de nascimento (AAAA-MM-DD) quando ainda não existe uma. */
  @Post('me/age')
  @HttpCode(200)
  declareAge(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.age.declare(actor.userId, { birthDate: b.birthDate });
  }
}
