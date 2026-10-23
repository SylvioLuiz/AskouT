import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { RateLimitPolicy } from './support/rate-limit-policy.ts';
import type { RateLimitRequest } from './support/rate-limit-policy.ts';
import type { AppConfig } from './support/config.ts';
import { CONFIG } from './tokens.ts';

/**
 * Guard global, roda antes da autenticação. Recusa com 429 e `Retry-After`.
 * Desligado só com RATE_LIMIT=off fora de produção (desenvolvimento e testes de ponta a ponta).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly policy = new RateLimitPolicy();
  private readonly enabled: boolean;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.enabled = config.rateLimitEnabled;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.enabled) this.policy.check(context.switchToHttp().getRequest<RateLimitRequest>());
    return true;
  }
}
