import { useEffect, useState } from 'react';

/**
 * Fim da página: quando a pessoa rola até o fim (ou tenta passar dele), uma luz leve acende no rodapé e some,
 * a mesma do chat. Só reage à rolagem feita pela pessoa (toque, roda do mouse), não à rolagem automática.
 */
export function EndGlow() {
  const [glow, setGlow] = useState(0);
  useEffect(() => {
    const gapToEnd = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    // Página que nem rola não acende nada.
    const scrollable = () => document.documentElement.scrollHeight > window.innerHeight + 8;
    let atEnd = gapToEnd() < 2;
    let userAt = 0;
    let glowAt = 0;
    let touchY: number | undefined;
    const light = () => {
      if (!scrollable()) return;
      const now = performance.now();
      if (now - glowAt < 900) return;
      glowAt = now;
      setGlow((n) => n + 1);
    };
    const onScroll = () => {
      const nowAtEnd = gapToEnd() < 2;
      if (nowAtEnd && !atEnd && performance.now() - userAt < 1200) light();
      atEnd = nowAtEnd;
    };
    const onTouchStart = (e: TouchEvent) => {
      userAt = performance.now();
      touchY = e.touches[0]?.clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      userAt = performance.now();
      const y = e.touches[0]?.clientY;
      // Já no fim e o dedo ainda subindo (querendo ver mais embaixo): acende de novo.
      if (y !== undefined && touchY !== undefined && touchY - y > 24 && gapToEnd() < 2) {
        light();
        touchY = y;
      }
    };
    const onWheel = (e: WheelEvent) => {
      userAt = performance.now();
      if (e.deltaY > 0 && gapToEnd() < 2) light();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['End', 'PageDown', 'ArrowDown', ' '].includes(e.key)) {
        userAt = performance.now();
        if (gapToEnd() < 2) light();
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return glow > 0 ? <span key={glow} className="endglow" aria-hidden="true" /> : null;
}
