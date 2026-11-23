/**
 * Última posição do aparelho vista pela tela do NOW (a mesma que vai para os encontros). Vai junto do convite e do
 * aceite, para a outra pessoa ver você no mapa assim que o encontro começa. Fica só na memória da página.
 */
export interface NowFix {
  lat: number;
  lng: number;
  accuracyM: number;
}

/** Mais velha que isso, não vale: a pessoa pode ter andado. */
export const NOW_FIX_MAX_AGE_MS = 2 * 60_000;

let last: (NowFix & { at: number }) | undefined;

export function rememberNowFix(fix: NowFix, at: number = Date.now()): void {
  last = { ...fix, at };
}

export function recentNowFix(now: number = Date.now()): NowFix | undefined {
  if (!last || now - last.at > NOW_FIX_MAX_AGE_MS) return undefined;
  return { lat: last.lat, lng: last.lng, accuracyM: last.accuracyM };
}
