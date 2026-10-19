/** Distância (px) que o dedo precisa percorrer para o puxar-para-atualizar disparar. */
export const PULL_TRIGGER = 70;
/** Quanto o indicador pode descer, no máximo. */
export const PULL_MAX = 96;

/** Dedo desceu `dy` px: o indicador acompanha com resistência (quanto mais puxa, mais "pesado"). */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX, Math.round(dy * 0.5));
}

/** Soltou: atualiza se o indicador passou do ponto. */
export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_TRIGGER * 0.5;
}

/** O gesto é vertical o bastante para ser um puxão (e não rolagem de lado)? */
export function isVerticalPull(dx: number, dy: number): boolean {
  return dy > 6 && dy > Math.abs(dx) * 1.5;
}
