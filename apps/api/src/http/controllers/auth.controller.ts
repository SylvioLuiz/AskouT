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
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.auth.login({ identifier: b.identifier, password: b.password });
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.core.auth.me(actor);
  }
}
