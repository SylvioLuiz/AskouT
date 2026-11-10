import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('auth')
export class AuthController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Public()
  @Post('signup')
  @HttpCode(200)
  signup(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.startSignup({
      email: b.email,
      username: b.username,
      displayName: b.displayName,
      password: b.password,
      birthDate: b.birthDate,
      acceptTerms: b.acceptTerms,
      marketingEmail: b.marketingEmail,
    });
  }

  @Public()
  @Post('signup/resend')
  @HttpCode(200)
  resend(@Body() body: unknown) {
    return this.core.auth.resendSignupCode(asBody(body).email);
  }

  @Public()
  @Post('signup/confirm')
  @HttpCode(201)
  confirm(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.confirmSignup({ email: b.email, code: b.code });
  }

  @Public()
  @Post('password-reset')
  @HttpCode(200)
  passwordReset(@Body() body: unknown) {
    return this.core.auth.requestPasswordReset(asBody(body).identifier);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  passwordResetConfirm(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.confirmPasswordReset({ identifier: b.identifier, code: b.code, password: b.password });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.login({ identifier: b.identifier, password: b.password });
  }

  @Public()
  @Get('providers')
  providers() {
    return { items: this.core.auth.socialProviders() };
  }

  @Public()
  @Post('social')
  @HttpCode(200)
  social(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.socialLogin({ provider: b.provider, idToken: b.idToken, username: b.username, displayName: b.displayName, birthDate: b.birthDate, acceptTerms: b.acceptTerms, marketingEmail: b.marketingEmail });
  }

  /** Segunda etapa do login quando a conta tem verificação em duas etapas. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  mfaVerify(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.verifyMfaLogin({ mfaToken: b.mfaToken, code: b.code });
  }

  @Get('mfa')
  mfaStatus(@CurrentActor() actor: Actor) {
    return this.core.auth.mfa.status(actor.userId);
  }

  /** Gera o segredo e o QR code. Só liga depois de confirmar com um código em mfa/enable. */
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentActor() actor: Actor) {
    return this.core.auth.mfa.setup(actor.userId);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.auth.mfa.enable(actor.userId, asBody(body).code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.auth.mfa.disable(actor.userId, asBody(body).code);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  mfaRecoveryCodes(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.auth.mfa.regenerateRecoveryCodes(actor.userId, asBody(body).code);
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.core.auth.me(actor);
  }

  /** Marca o tutorial inicial como visto (concluído ou pulado), para não aparecer de novo. */
  @Post('me/onboarding')
  @HttpCode(200)
  completeOnboarding(@CurrentActor() actor: Actor) {
    return this.core.auth.completeOnboarding(actor);
  }
}
