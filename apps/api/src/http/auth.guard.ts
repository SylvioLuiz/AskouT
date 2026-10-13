import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Core } from '../core/index.ts';
import { unauthorized } from '../core/errors.ts';
import { IS_PUBLIC } from './decorators.ts';
import type { AuthedRequest } from './decorators.ts';
import { CORE } from './tokens.ts';
import { bearerToken } from './support/parse.ts';

/**
 * Guard global. Verifica o token E consulta o usuário no banco a cada requisição
 * (AuthService.authenticate): conta suspensa ou removida perde o acesso na hora, e o papel vem do banco.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly core: Core;
  private readonly reflector: Reflector;

  constructor(@Inject(CORE) core: Core, @Inject(Reflector) reflector: Reflector) {
    this.core = core;
    this.reflector = reflector;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(request.headers['authorization']);
    if (!token) throw unauthorized('Faça login para continuar');
    request.actor = await this.core.auth.authenticate(token);
    return true;
  }
}
