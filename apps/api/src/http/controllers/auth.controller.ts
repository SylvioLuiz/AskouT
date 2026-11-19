import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { AllowPendingProfile, CurrentActor, Public } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Rotas de conta: liberadas também para quem ainda está completando o cadastro do Google/Apple. */
@AllowPendingProfile()
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
    return { items: this.core.auth.socialProviders(), phone: this.core.auth.phoneLoginMethods() };
  }

  /** Entrar pelo celular sem senha, com o código do app autenticador (ou de recuperação). */
  @Public()
  @Post('phone/login')
  @HttpCode(200)
  phoneLogin(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.loginWithPhoneAuthenticator({ phone: b.phone, code: b.code });
  }

  /** Entrar pelo celular com código por SMS, etapa 1. Só funciona com SMS_TRANSPORT configurado. */
  @Public()
  @Post('phone/sms')
  @HttpCode(200)
  phoneSms(@Body() body: unknown) {
    return this.core.auth.startPhoneLogin(asBody(body).phone);
  }

  /** Etapa 2: confere o código do SMS. Com app autenticador ligado, ainda devolve o desafio do MFA. */
  @Public()
  @Post('phone/sms/confirm')
  @HttpCode(200)
  phoneSmsConfirm(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.confirmPhoneLogin({ phone: b.phone, code: b.code });
  }

  /** Confirmar o celular do perfil por SMS (necessário para entrar pelo SMS). */
  @Post('me/phone/verify')
  @HttpCode(200)
  phoneVerifyStart(@CurrentActor() actor: Actor) {
    return this.core.auth.startPhoneVerification(actor.userId);
  }

  @Post('me/phone/verify/confirm')
  @HttpCode(200)
  phoneVerifyConfirm(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.auth.confirmPhoneVerification(actor.userId, asBody(body).code);
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

  /** `{token}` renovado. O app chama ao abrir, para a sessão só expirar depois de muito tempo sem uso. */
  @Post('refresh')
  @HttpCode(200)
  refresh(@CurrentActor() actor: Actor) {
    return this.core.auth.refresh(actor);
  }

  /** Marca o tutorial inicial como visto (concluído ou pulado), para não aparecer de novo. */
  @Post('me/onboarding')
  @HttpCode(200)
  completeOnboarding(@CurrentActor() actor: Actor) {
    return this.core.auth.completeOnboarding(actor);
  }

  /** Gostos de rolê da pessoa (`{tastes: ['BAR', 'SHOW']}`): escolhidos no cadastro e editáveis nas configurações. */
  @Put('me/tastes')
  @HttpCode(200)
  setTastes(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.auth.setTastes(actor, asBody(body).tastes);
  }

  /** "Complete seu cadastro" de quem entrou pela primeira vez com Google/Apple: nome de usuário, data de nascimento e aceite. */
  @Post('me/profile')
  @HttpCode(200)
  completeProfile(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.completeProfile(actor, { username: b.username, displayName: b.displayName, birthDate: b.birthDate, acceptTerms: b.acceptTerms, marketingEmail: b.marketingEmail });
  }

  /** Nome de usuário livre? (conferência enquanto a pessoa digita) */
  @Get('me/username-available')
  usernameAvailable(@CurrentActor() actor: Actor, @Query('username') username: unknown) {
    return this.core.auth.usernameAvailable(actor, username);
  }

  /** Contas do Google e da Apple ligadas a este perfil. */
  @Get('me/linked-accounts')
  linkedAccounts(@CurrentActor() actor: Actor) {
    return this.core.auth.linkedAccounts(actor);
  }

  /** Liga uma conta do Google/Apple ao perfil (token de identidade da plataforma). */
  @Post('me/linked-accounts')
  @HttpCode(200)
  linkAccount(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.linkAccount(actor, { provider: b.provider, idToken: b.idToken });
  }

  @Delete('me/linked-accounts/:provider')
  @HttpCode(200)
  unlinkAccount(@CurrentActor() actor: Actor, @Param('provider') provider: string) {
    return this.core.auth.unlinkAccount(actor, provider);
  }
}
