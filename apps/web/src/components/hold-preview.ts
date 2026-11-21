import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { LONG_PRESS_MS } from '../lib/chat.ts';

const MOVE_TOLERANCE_PX = 10;

/**
 * Segurar abre uma prévia; soltar o dedo (ou arrastar para rolar) fecha. Depois de segurar, o toque não abre o link.
 */
export function useHoldPreview(onOpen: () => void, onClose: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const fired = useRef(false);
  const open = useRef(onOpen);
  const close = useRef(onClose);
  open.current = onOpen;
  close.current = onClose;
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const end = () => {
    window.clearTimeout(timer.current);
    start.current = undefined;
    if (fired.current) close.current();
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        fired.current = true;
        start.current = undefined;
        navigator.vibrate?.(10);
        open.current();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (s && Math.hypot(event.clientX - s.x, event.clientY - s.y) > MOVE_TOLERANCE_PX) {
        window.clearTimeout(timer.current);
        start.current = undefined;
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: end,
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    /** Soltar depois de segurar não abre o evento. */
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
  };
}
