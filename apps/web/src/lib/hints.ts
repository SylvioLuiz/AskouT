const FOLLOW_KEY = 'askout.hint.follow';

export const FOLLOW_HINT = 'Quando vocês se seguirem, viram amigos. Aí dá para conversar, marcar encontros e ver os planos um do outro.';

/** Devolve true só na primeira vez (e grava que a dica já foi dada). Sem armazenamento, a dica aparece sempre. */
export function takeFirstFollowHint(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): boolean {
  try {
    if (storage?.getItem(FOLLOW_KEY) === '1') return false;
    storage?.setItem(FOLLOW_KEY, '1');
  } catch {
    return true;
  }
  return true;
}

export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
