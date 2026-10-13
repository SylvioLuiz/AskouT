import type { Follow } from './types.ts';

/**
 * Regra de amizade do AskouT (briefing, seção 6.3): duas pessoas são amigas quando
 * seguem uma à outra (seguimento ACEITO nos dois sentidos) e não há bloqueio
 * em nenhum sentido. Mesma semântica da view SQL `friendships`.
 */
export function evaluateFriendship(
  aFollowsB: Follow | undefined,
  bFollowsA: Follow | undefined,
  blockedEitherWay: boolean,
): boolean {
  return !blockedEitherWay && aFollowsB?.status === 'ACCEPTED' && bFollowsA?.status === 'ACCEPTED';
}
