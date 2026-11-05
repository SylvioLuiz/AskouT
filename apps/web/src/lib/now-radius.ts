import { safeStorage } from './hints.ts';

/** Opções de distância para buscar rolês entre você e o amigo no encontro do NOW (km). `null` = automático. */
export const NOW_RADIUS_CHOICES_KM: readonly number[] = [2, 5, 10, 25];
const KEY = 'askout.now.radiusKm';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined;

/** Distância escolhida na Configuração, ou `null` (automático: cresce com a distância entre os dois). */
export function nowRadiusKm(storage: Store = safeStorage()): number | null {
  try {
    const v = Number(storage?.getItem(KEY));
    return NOW_RADIUS_CHOICES_KM.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function setNowRadiusKm(km: number | null, storage: Store = safeStorage()): void {
  try {
    if (km === null || !NOW_RADIUS_CHOICES_KM.includes(km)) storage?.removeItem(KEY);
    else storage?.setItem(KEY, String(km));
  } catch {
    // sem armazenamento: vale o automático
  }
}
