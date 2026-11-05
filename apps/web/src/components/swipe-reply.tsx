import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { ReplyIcon } from './icons.tsx';
import { SLOP, TRIGGER_OFFSET, rubberOffset, swipeTriggered } from '../lib/swipe.ts';

/**
 * Linha de mensagem que acompanha o dedo ao ser puxada para a direita e volta sozinha, como uma mola.
 * Soltar depois do ponto de disparo (com um toque de vibração ao cruzar) chama `onReply`.
 * Só reage a toque e caneta; o mouse usa o menu da mensagem.
 */
export function SwipeRow({ id, className, enabled, onReply, children }: { id?: string; className: string; enabled: boolean; onReply: () => void; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef<{ pointer: number; x: number; y: number; mode: 'unknown' | 'swipe' | 'scroll'; offset: number; armed: boolean } | undefined>(undefined);

  function paint(offset: number, animate: boolean) {
    const row = rowRef.current;
    const icon = iconRef.current;
    if (row) {
      row.style.transition = animate ? 'transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none';
      row.style.transform = offset === 0 ? '' : `translateX(${offset}px)`;
    }
    if (icon) {
      const progress = Math.min(1, offset / TRIGGER_OFFSET);
      icon.style.transition = animate ? 'opacity 200ms ease, transform 200ms ease' : 'none';
      icon.style.opacity = String(progress);
      icon.style.transform = `scale(${0.5 + 0.5 * progress})`;
      icon.classList.toggle('is-ready', swipeTriggered(offset));
    }
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return;
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode: 'unknown', offset: 0, armed: false };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId || g.mode === 'scroll') return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.mode === 'unknown') {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
        g.mode = 'swipe';
        event.currentTarget.setPointerCapture(event.pointerId);
      } else {
        g.mode = 'scroll';
        return;
      }
    }
    g.offset = rubberOffset(dx - SLOP);
    const crossed = swipeTriggered(g.offset);
    if (crossed && !g.armed && typeof navigator.vibrate === 'function') navigator.vibrate(12);
    g.armed = crossed;
    paint(g.offset, false);
  }

  function end(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    gesture.current = undefined;
    if (g.mode !== 'swipe') return;
    const fire = !cancelled && swipeTriggered(g.offset);
    paint(0, true);
    if (fire) onReply();
  }

  return (
    <div ref={rowRef} id={id} className={`${className} msg--swipeable`} onPointerDown={down} onPointerMove={move} onPointerUp={(e) => end(e, false)} onPointerCancel={(e) => end(e, true)}>
      <span ref={iconRef} className="msg__swipe" aria-hidden="true">
        <ReplyIcon />
      </span>
      {children}
    </div>
  );
}

/** Até onde a conversa anda para a esquerda ao puxar, mostrando a hora de cada mensagem. */
export const REVEAL_MAX = 64;

/**
 * Puxar a conversa para a esquerda (com o dedo) mostra a hora de todas as mensagens, como nas DMs;
 * soltar faz tudo voltar. Mexe só numa variável de CSS da lista, sem redesenhar as mensagens.
 */
export function useTimeReveal(ref: RefObject<HTMLDivElement | null>) {
  const gesture = useRef<{ pointer: number; x: number; y: number; mode: 'unknown' | 'reveal' | 'other' } | undefined>(undefined);

  function set(offset: number, dragging: boolean) {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle('is-revealing', dragging);
    if (offset === 0) el.style.removeProperty('--reveal');
    else el.style.setProperty('--reveal', `${offset}px`);
  }

  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode: 'unknown' };
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.pointer !== event.pointerId || g.mode === 'other') return;
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      if (g.mode === 'unknown') {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        g.mode = dx < 0 && Math.abs(dx) > Math.abs(dy) ? 'reveal' : 'other';
        if (g.mode === 'other') return;
      }
      set(Math.min(REVEAL_MAX, Math.max(0, -dx - SLOP)), true);
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.pointer !== event.pointerId) return;
      gesture.current = undefined;
      if (g.mode === 'reveal') set(0, false);
    },
    onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.pointer !== event.pointerId) return;
      gesture.current = undefined;
      set(0, false);
    },
  };
}
