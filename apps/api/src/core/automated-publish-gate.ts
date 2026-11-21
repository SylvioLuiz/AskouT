/**
 * Regra de propriedade para publicação AUTOMÁTICA de eventos (importador, Hunter): só pode publicar em local que ainda não
 * tem responsável. Uma função só, usada em todo lugar, para a regra não divergir.
 *
 * - Local com responsável (`ownerId`): não publica.
 * - Pedido de reivindicação pendente: não publica (suspende por precaução).
 * - Pedido rejeitado, sozinho: pode publicar.
 * - Local não encontrado ou consulta que falhou (`claims` nulo): não publica até confirmar.
 * Aprovado sem `ownerId` (o administrador removeu o dono) conta como sem responsável: vale o `ownerId` atual.
 */
export type ClaimStatusLike = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PublishDenied = 'OWNED' | 'CLAIM_PENDING' | 'UNKNOWN';
export type PublishGate = { allowed: true } | { allowed: false; reason: PublishDenied };

export function automatedPublishGate(venue: { ownerId: string | null } | null | undefined, claims: readonly ClaimStatusLike[] | null | undefined): PublishGate {
  if (!venue || !claims) return { allowed: false, reason: 'UNKNOWN' };
  if (venue.ownerId) return { allowed: false, reason: 'OWNED' };
  if (claims.includes('PENDING')) return { allowed: false, reason: 'CLAIM_PENDING' };
  return { allowed: true };
}
