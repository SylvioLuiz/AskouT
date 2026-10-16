/** Quanto a mensagem pode se afastar (px) e a partir de quanto o gesto vale como "responder". */
export const MAX_OFFSET = 96;
export const TRIGGER_OFFSET = 56;
/** Movimento mínimo para decidir se o gesto é horizontal (responder) ou vertical (rolar a conversa). */
export const SLOP = 8;

/** Curva de borracha: acompanha o dedo no começo e vai endurecendo até o limite. */
export function rubberOffset(dx: number): number {
  if (dx <= 0) return 0;
  return MAX_OFFSET * (1 - Math.exp(-dx / MAX_OFFSET));
}

export function swipeTriggered(offset: number): boolean {
  return offset >= TRIGGER_OFFSET;
}

