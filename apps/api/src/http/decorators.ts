import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Actor } from '../core/types.ts';

export const IS_PUBLIC = 'askout:isPublic';
/** Rota aberta (cadastro, login). Todas as outras exigem token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  actor?: Actor;
}

/** Quem está autenticado; o guard global garante que existe em toda rota não pública. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (!request.actor) throw new Error('Rota sem autenticação usando CurrentActor');
  return request.actor;
});
