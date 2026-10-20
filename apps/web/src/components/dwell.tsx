import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { DwellQueue, VisibleTimer, readPersonalize } from '../lib/dwell.ts';
import type { DwellSource, DwellTarget } from '../lib/dwell.ts';

const queue = new DwellQueue();
let userId: string | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let listening = false;

/** Envia as medições juntas (nunca uma por rolagem). Se falhar, descarta: medir não pode atrapalhar o uso. */
function flush(): void {
  if (!userId || !readPersonalize(userId)) {
    queue.drain(Number.MAX_SAFE_INTEGER);
    return;
  }
  const batch = queue.drain();
  if (batch.length === 0) return;
  void api.recordDwell(batch).catch(() => undefined);
  if (queue.size > 0) setTimeout(flush, 500);
}

function ensureScheduler(): void {
  if (!interval) interval = setInterval(flush, 15_000);
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

/**
 * Mede quanto tempo o conteúdo fica na tela (pelo menos 60% visível, aba aberta) e manda em lote.
 * Só mede se a pessoa não desligou "Recomendações personalizadas" em Privacidade.
 */
export function useDwell<T extends Element>(targetType: DwellTarget, targetId: string, source: DwellSource | false): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const me = useUser().profile.userId;
  useEffect(() => {
    userId = me;
    const node = ref.current;
    if (source === false || !node || typeof IntersectionObserver === 'undefined' || !readPersonalize(me)) return;
    ensureScheduler();
    const timer = new VisibleTimer();
    let inView = false;
    const settle = () => {
      const ms = timer.stop(Date.now());
      if (ms > 0) queue.add({ targetType, targetId, ms, source });
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView && document.visibilityState === 'visible') timer.start(Date.now());
        else settle();
      },
      { threshold: 0.6 },
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && inView) timer.start(Date.now());
      else settle();
    };
    watcher.observe(node);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      watcher.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      settle();
    };
  }, [me, targetType, targetId, source]);
  return ref;
}
