import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent, TouchEvent } from 'react';
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
  const begin = (x: number, y: number) => {
    fired.current = false;
    start.current = { x, y };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      fired.current = true;
      start.current = undefined;
      navigator.vibrate?.(10);
      open.current();
    }, LONG_PRESS_MS);
  };
  const moved = (x: number, y: number) => {
    const s = start.current;
    if (s && Math.hypot(x - s.x, y - s.y) > MOVE_TOLERANCE_PX) {
      window.clearTimeout(timer.current);
      start.current = undefined;
    }
  };
  return {
    // Dedo: eventos de toque (no iPhone, segurar um link dispara "pointercancel" e a prévia fechava na hora).
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (touch && event.touches.length === 1) begin(touch.clientX, touch.clientY);
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (touch) moved(touch.clientX, touch.clientY);
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const wasOpen = fired.current;
      end();
      if (wasOpen && event.cancelable) event.preventDefault();
    },
    onTouchCancel: end,
    // Mouse e caneta: eventos de pointer.
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      begin(event.clientX, event.clientY);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') moved(event.clientX, event.clientY);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') end();
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') end();
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') end();
    },
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
