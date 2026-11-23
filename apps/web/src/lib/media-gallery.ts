/**
 * Navegar entre as fotos e vídeos da conversa no visualizador em tela cheia.
 * Conta pura para testar sem navegador.
 */

/** Arrasto mínimo para trocar de foto: 60 px ou 18% da largura, o que for menor. */
export function swipeThreshold(width: number): number {
  return Math.min(60, width * 0.18);
}

/** Para onde o arrasto leva: 1 = próxima (arrastou para a esquerda), -1 = anterior, 0 = fica. */
export function swipeStep(dx: number, width: number): -1 | 0 | 1 {
  if (Math.abs(dx) < swipeThreshold(width)) return 0;
  return dx < 0 ? 1 : -1;
}

/** Arrasto de um dedo vira horizontal ou vertical no primeiro movimento claro (8 px); antes disso, ainda não decidiu. */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | undefined {
  if (Math.hypot(dx, dy) < 8) return undefined;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** Posição seguinte dentro da lista, ou undefined se já está na ponta. */
export function stepIndex(index: number, step: -1 | 1, total: number): number | undefined {
  const next = index + step;
  return next >= 0 && next < total ? next : undefined;
}

/** Na ponta da lista o arrasto anda só um terço, como uma mola, para mostrar que não há mais. */
export function edgeResist(dx: number, canGo: boolean): number {
  return canGo ? dx : dx / 3;
}
