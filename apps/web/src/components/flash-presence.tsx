import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../client.ts';
import { usePolling } from '../hooks.ts';
import { FLASH_CHANGED_EVENT } from '../lib/flash.ts';

const Presence = createContext<ReadonlySet<string>>(new Set());

/** Guarda quem está com o Flash ligado (eu e amigos que posso ver) para o raio aparecer em todo avatar. */
export function FlashPresenceProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const load = useCallback(() => {
    api.flashActive().then(
      (r) => setIds((current) => (current.size === r.userIds.length && r.userIds.every((id) => current.has(id)) ? current : new Set(r.userIds))),
      () => undefined, // sem rede: mantém o que já sabia
    );
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(FLASH_CHANGED_EVENT, load);
    return () => window.removeEventListener(FLASH_CHANGED_EVENT, load);
  }, [load]);
  usePolling(load, 30_000);
  const value = useMemo(() => ids, [ids]);
  return <Presence.Provider value={value}>{children}</Presence.Provider>;
}

/** Essa pessoa está com o Flash ligado (e eu posso ver)? */
export function useFlashOn(userId: string | undefined): boolean {
  const ids = useContext(Presence);
  return userId !== undefined && ids.has(userId);
}
