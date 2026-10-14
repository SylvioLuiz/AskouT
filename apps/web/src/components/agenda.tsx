import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { dayChip, dayLongLabel, LEVEL_LABEL, PARTICIPANT_LABEL, STATE_LABEL } from '../lib/agenda.ts';
import type { CompatibilityLevel, ParticipantStatus, SlotState } from '../lib/types.ts';
import { AlertIcon, CheckIcon, ClockIcon, HalfIcon, XIcon } from './icons.tsx';

// Cor nunca sozinha: todo estado de agenda vem com ícone e texto (acessibilidade e daltonismo).

const STATE_ICON: Record<SlotState, ReactNode> = {
  AVAILABLE: <CheckIcon />,
  PARTIAL: <HalfIcon />,
  UNAVAILABLE: <XIcon />,
};

const STATE_TONE: Record<SlotState, string> = { AVAILABLE: 'ok', PARTIAL: 'warn', UNAVAILABLE: 'bad' };

export function StateMark({ state }: { state: SlotState }) {
  return (
    <span className={`mark mark--${STATE_TONE[state]}`}>
      {STATE_ICON[state]}
      {STATE_LABEL[state]}
    </span>
  );
}

const LEVEL_ICON: Record<CompatibilityLevel, ReactNode> = {
  green: <CheckIcon />,
  orange: <AlertIcon />,
  red: <XIcon />,
  awaiting: <ClockIcon />,
};
const LEVEL_TONE: Record<CompatibilityLevel, string> = { green: 'ok', orange: 'warn', red: 'bad', awaiting: 'wait' };

export function LevelBadge({ level }: { level: CompatibilityLevel }) {
  return (
    <span className={`mark mark--${LEVEL_TONE[level]} mark--strong`}>
      {LEVEL_ICON[level]}
      {LEVEL_LABEL[level]}
    </span>
  );
}

const PARTICIPANT_ICON: Record<ParticipantStatus, ReactNode> = {
  available: <CheckIcon />,
  partial: <HalfIcon />,
  unavailable: <XIcon />,
  unknown: <ClockIcon />,
};
const PARTICIPANT_TONE: Record<ParticipantStatus, string> = { available: 'ok', partial: 'warn', unavailable: 'bad', unknown: 'wait' };

export function ParticipantMark({ status }: { status: ParticipantStatus }) {
  return (
    <span className={`mark mark--${PARTICIPANT_TONE[status]}`}>
      {PARTICIPANT_ICON[status]}
      {PARTICIPANT_LABEL[status]}
    </span>
  );
}

// ---------- Faixa de dias ----------

interface DayStripProps {
  days: readonly string[];
  selected: string;
  today: string;
  onSelect: (key: string) => void;
  /** Estados com horário marcado em cada dia (viram as marcas embaixo do número). */
  statesOf: (key: string) => readonly SlotState[];
}

/** Faixa horizontal que rola com o dedo; o dia escolhido sempre fica visível. */
export function DayStrip({ days, selected, today, onSelect, statesOf }: DayStripProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selected]);

  return (
    <div className="daystrip" role="group" aria-label="Escolha o dia">
      {days.map((key) => {
        const chip = dayChip(key);
        const states = statesOf(key);
        const isSelected = key === selected;
        const summary = states.length === 0 ? 'sem horários' : states.map((s) => STATE_LABEL[s].toLowerCase()).join(', ');
        return (
          <button
            key={key}
            ref={isSelected ? selectedRef : undefined}
            type="button"
            className={`daychip${isSelected ? ' daychip--selected' : ''}${key === today ? ' daychip--today' : ''}`}
            aria-pressed={isSelected}
            aria-label={`${dayLongLabel(key)}${key === today ? ', hoje' : ''}: ${summary}`}
            onClick={() => onSelect(key)}
          >
            <span className="daychip__weekday">{chip.weekday}</span>
            <span className="daychip__day">{chip.day}</span>
            <span className="daychip__marks" aria-hidden="true">
              {states.map((s) => (
                <span key={s} className={`daymark daymark--${STATE_TONE[s]}`} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Folha inferior ----------

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** No celular sobe da base da tela; em telas grandes vira uma janela no centro. Fecha com Esc ou toque fora. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Puxar o topo da aba para baixo fecha; soltar antes do limite faz ela voltar.
  const drag = useRef<{ startY: number; lastY: number; lastT: number; velocity: number; id: number } | undefined>(undefined);
  function onDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag.current = { startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (panelRef.current) panelRef.current.style.transition = 'none';
  }
  function onDragMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !panelRef.current) return;
    const dy = Math.max(0, event.clientY - d.startY);
    const dt = event.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    panelRef.current.style.transform = `translateY(${dy}px)`;
  }
  function onDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = undefined;
    const panel = panelRef.current;
    if (!d || !panel) return;
    const dy = Math.max(0, event.clientY - d.startY);
    panel.style.transition = 'transform 0.2s ease-out';
    if (dy > 90 || (dy > 30 && d.velocity > 0.5)) {
      panel.style.transform = 'translateY(100%)';
      window.setTimeout(() => closeRef.current(), 160);
    } else {
      panel.style.transform = '';
    }
  }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab' || !panelRef.current) return;
      // Mantém o foco dentro da folha.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
    // Só roda ao abrir e ao fechar: não pode devolver o foco à folha a cada nova renderização.
  }, []);

  return (
    <div className="sheet" onMouseDown={(event) => event.target === event.currentTarget && closeRef.current()}>
      <div className="sheet__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <div className="sheet__drag" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          <div className="sheet__grab" aria-hidden="true" />
          <div className="sheet__head">
            <h2 className="sheet__title">{title}</h2>
            {/* No celular fecha-se puxando a aba para baixo; o botão só aparece em tela grande (e para leitor de tela). */}
            <button type="button" className="sheet__close" onClick={() => closeRef.current()} onPointerDown={(event) => event.stopPropagation()} aria-label="Fechar">
              <XIcon />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
