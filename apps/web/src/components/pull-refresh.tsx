import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshIcon } from './icons.tsx';
import { PULL_TRIGGER, isVerticalPull, pullDistance, shouldRefresh } from '../lib/pull.ts';

/**
 * Puxar a tela para baixo, estando no topo, atualiza o conteúdo.
 * `onRefresh` devolve uma promessa; o indicador fica girando até ela terminar.
 */
export function PullRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown> | void; children: ReactNode }) {
  const [distance, setDistance] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const busyRef = useRef(false);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let pulling = false;
    let current = 0;

    function onStart(event: TouchEvent) {
      const target = event.target as Element | null;
      tracking = false;
      pulling = false;
      if (busyRef.current || event.touches.length !== 1 || window.scrollY > 0) return;
      if (target?.closest('.sheet, [role="dialog"], .storyview, input, textarea')) return;
      startX = event.touches[0]!.clientX;
      startY = event.touches[0]!.clientY;
      tracking = true;
    }

    function onMove(event: TouchEvent) {
      if (!tracking) return;
      const dx = event.touches[0]!.clientX - startX;
      const dy = event.touches[0]!.clientY - startY;
      if (!pulling) {
        if (dy < -6 || Math.abs(dx) > 12 && !isVerticalPull(dx, dy)) {
          tracking = false;
          return;
        }
        if (!isVerticalPull(dx, dy)) return;
        pulling = true;
      }
      if (window.scrollY > 0) {
        tracking = false;
        pulling = false;
        current = 0;
        setDistance(0);
        return;
      }
      if (event.cancelable) event.preventDefault();
      current = pullDistance(dy);
      setDistance(current);
    }

    function onEnd() {
      if (!pulling) {
        tracking = false;
        return;
      }
      const go = shouldRefresh(current);
      tracking = false;
      pulling = false;
      current = 0;
      if (!go) {
        setDistance(0);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setDistance(PULL_TRIGGER * 0.5);
      void Promise.resolve(refresh.current())
        .catch(() => undefined)
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
          setDistance(0);
        });
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div className="ptr" style={{ transform: distance > 0 ? `translateY(${distance}px)` : undefined, transition: distance === 0 || busy ? 'transform 180ms ease-out' : 'none' }}>
      <div className={`ptr__spinner${busy ? ' ptr__spinner--busy' : ''}`} style={{ opacity: Math.min(1, distance / 36) }} role="status" aria-live="polite" aria-label={busy ? 'Atualizando' : undefined}>
        <RefreshIcon />
      </div>
      {children}
    </div>
  );
}
