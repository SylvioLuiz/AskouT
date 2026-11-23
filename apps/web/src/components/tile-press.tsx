import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './agenda.tsx';
import { Button } from './ui.tsx';
import { LONG_PRESS_MS } from '../lib/chat.ts';
import { t } from '../lib/i18n/index.ts';
import { haptic } from '../lib/haptics.ts';

/** Quanto o dedo pode andar antes de virar rolagem (e cancelar o "segurar"). */
const MOVE_TOLERANCE_PX = 10;

/**
 * Tocar e segurar (celular) ou clicar com o botão direito (computador) abre as opções do cartão.
 * Depois de segurar, o toque não abre o link, e o menu nativo do sistema (copiar, abrir em nova aba) não aparece.
 */
export function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!enabled) return {};
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = undefined;
  };
  const begin = (x: number, y: number) => {
    fired.current = false;
    start.current = { x, y };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      fired.current = true;
      start.current = undefined;
      haptic('tap');
      callback.current();
    }, LONG_PRESS_MS);
  };
  const moved = (x: number, y: number) => {
    const s = start.current;
    if (s && Math.hypot(x - s.x, y - s.y) > MOVE_TOLERANCE_PX) cancel();
  };
  return {
    // Dedo: eventos de toque. No iPhone, segurar um link dispara "pointercancel" e o menu nunca abria pelos eventos de pointer.
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (touch && event.touches.length === 1) begin(touch.clientX, touch.clientY);
      else cancel();
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (touch) moved(touch.clientX, touch.clientY);
    },
    onTouchCancel: cancel,
    /** Depois de segurar, soltar o dedo não gera o clique de compatibilidade (que fecharia o menu recém-aberto). */
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      cancel();
      if (fired.current && event.cancelable) event.preventDefault();
    },
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
      if (event.pointerType !== 'touch') cancel();
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') cancel();
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') cancel();
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      if (!fired.current) {
        fired.current = true;
        cancel();
        callback.current();
      }
    },
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

export interface TileAction {
  label: string;
  busy: boolean;
  run: () => void;
  danger?: boolean;
}

/** Opções que aparecem ao segurar um cartão da grade do perfil. */
export function TileMenu({ title, actions, onClose }: { title: string; actions: TileAction[]; onClose: () => void }) {
  // O toque que abriu o menu ainda pode chegar ao fundo da folha ao soltar o dedo: nesse instante, não fecha.
  const openedAt = useRef(Date.now());
  const closeFromSheet = () => {
    if (Date.now() - openedAt.current > 500) onClose();
  };
  return createPortal(
    <Sheet title={title} onClose={closeFromSheet}>
      <div className="sheetactions">
        {actions.map((a) => (
          <Button
            key={a.label}
            full
            variant={a.danger ? 'danger' : 'secondary'}
            loading={a.busy}
            onClick={() => {
              a.run();
              onClose();
            }}
          >
            {a.label}
          </Button>
        ))}
        <Button full variant="secondary" onClick={onClose}>
          {t('Cancelar')}
        </Button>
      </div>
    </Sheet>,
    document.body,
  );
}

/** Estado do menu de um cartão: segurar abre; um botão só para leitor de tela e teclado faz o mesmo. */
export function useTileMenu(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const press = useLongPress(() => setOpen(true), enabled);
  return { open, setOpen, press };
}
