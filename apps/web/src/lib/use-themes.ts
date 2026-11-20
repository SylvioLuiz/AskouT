import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../client.ts';
import { setThemes, subscribeThemes, THEMES, themesVersion } from './themes.ts';
import type { Theme } from './themes.ts';

let requested = false;

/** Busca os gostos cadastrados pela gestão uma vez por abertura do app; se falhar, ficam os de origem. */
function loadThemes(): void {
  if (requested) return;
  requested = true;
  api
    .tastes()
    .then((r) => setThemes(r.items))
    .catch(() => {
      requested = false;
    });
}

/** A lista de gostos de rolê. Redesenha a tela quando a lista da gestão chega. */
export function useThemes(): readonly Theme[] {
  useSyncExternalStore(subscribeThemes, themesVersion);
  useEffect(loadThemes, []);
  return THEMES;
}
