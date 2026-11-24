import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../client.ts';
import { usePolling } from '../hooks.ts';

/** Disparado quando a pessoa liga ou desliga "Mostrar quando estou online": a bolinha dos outros atualiza na hora. */
export const ONLINE_CHANGED_EVENT = 'askout:online-changed';

const Online = createContext<ReadonlySet<string>>(new Set());

/**
 * Bolinha verde de online em todo avatar. Com a tela visível, pergunta a cada 30 s quem está online: a mesma chamada
 * avisa o servidor de que eu estou com o app aberto. Ao esconder a tela (outra aba, app em segundo plano), avisa que saí.
 */
export function OnlinePresenceProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const load = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    api.presenceOnline().then(
      (r) => setIds((current) => (current.size === r.userIds.length && r.userIds.every((id) => current.has(id)) ? current : new Set(r.userIds))),
      () => undefined, // sem rede: mantém o que já sabia
    );
  }, []);
  useEffect(() => {
    load();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') api.presenceAway().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(ONLINE_CHANGED_EVENT, load);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(ONLINE_CHANGED_EVENT, load);
    };
  }, [load]);
  usePolling(load, 30_000);
  const value = useMemo(() => ids, [ids]);
  return <Online.Provider value={value}>{children}</Online.Provider>;
}

/** Essa pessoa está online agora (e eu posso ver)? */
export function useOnline(userId: string | undefined): boolean {
  const ids = useContext(Online);
  return userId !== undefined && ids.has(userId);
}
