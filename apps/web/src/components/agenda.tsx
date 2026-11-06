import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { dayChip, dayLongLabel, monthLabel, LEVEL_LABEL, PARTICIPANT_LABEL, STATE_LABEL } from '../lib/agenda.ts';
import type { CompatibilityLevel, ParticipantStatus, SlotState } from '../lib/types.ts';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, HalfIcon, XIcon } from './icons.tsx';
import { t } from '../lib/i18n/index.ts';

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
  /** Quantos eventos em que você vai caem no dia (viram uma marca própria no dia). */
  eventsOf?: (key: string) => number;
}

/** Faixa horizontal que rola com o dedo; o dia escolhido desliza até o centro. Setas do teclado trocam o dia. */
export function DayStrip({ days, selected, today, onSelect, statesOf, eventsOf }: DayStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);

  // Rola só a faixa (não a página) para centralizar o dia escolhido; na primeira vez, sem animação.
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-day="${selected}"]`);
    if (!strip || !chip) return;
    const left = chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    strip.scrollTo({ left: Math.max(0, left), behavior: firstScroll.current || reduce ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [selected]);

  const index = days.indexOf(selected);
  function move(by: number) {
    const next = days[Math.min(days.length - 1, Math.max(0, index + by))];
    if (next && next !== selected) onSelect(next);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, () => void> = {
      ArrowRight: () => move(1),
      ArrowLeft: () => move(-1),
      Home: () => onSelect(today),
      End: () => days.length > 0 && onSelect(days[days.length - 1] as string),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
    // O foco acompanha o dia escolhido.
    window.requestAnimationFrame(() => stripRef.current?.querySelector<HTMLElement>('.daychip--selected')?.focus());
  }

  return (
    <div className="daynav">
      <div className="daynav__bar">
        <span className="daynav__month" aria-live="polite">{capitalizeFirst(monthLabel(selected))}</span>
        <div className="daynav__actions">
          {selected !== today ? (
            <button type="button" className="daynav__today" onClick={() => onSelect(today)}>
              {t('Hoje')}
            </button>
          ) : null}
          <button type="button" className="iconbtn daynav__arrow" onClick={() => move(-1)} disabled={index <= 0} aria-label={t('Dia anterior')}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="iconbtn daynav__arrow" onClick={() => move(1)} disabled={index >= days.length - 1} aria-label={t('Próximo dia')}>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      <div className="daystrip" role="group" aria-label={t('Escolha o dia')} ref={stripRef} onKeyDown={onKeyDown}>
        {days.map((key) => {
          const chip = dayChip(key);
          const states = statesOf(key);
          const isSelected = key === selected;
          const isToday = key === today;
          const events = eventsOf?.(key) ?? 0;
          const slotSummary = states.length === 0 ? t('sem horários') : states.map((s) => STATE_LABEL[s].toLowerCase()).join(', ');
          const summary = events > 0 ? `${slotSummary}, ${events === 1 ? '1 evento' : `${events} eventos`} confirmado${events === 1 ? '' : 's'}` : slotSummary;
          return (
            <button
              key={key}
              data-day={key}
              type="button"
              tabIndex={isSelected ? 0 : -1}
              className={`daychip${isSelected ? ' daychip--selected' : ''}${isToday ? ' daychip--today' : ''}${events > 0 ? ' daychip--event' : ''}`}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${dayLongLabel(key)}${isToday ? `, ${t('hoje')}` : ''}: ${summary}`}
              onClick={() => onSelect(key)}
            >
              <span className="daychip__weekday">{isToday ? t('hoje') : chip.weekday}</span>
              <span className="daychip__day">{chip.day}</span>
              <span className="daychip__marks" aria-hidden="true">
                {events > 0 ? <span className="daymark daymark--event" /> : null}
                {states.map((s) => (
                  <span key={s} className={`daymark daymark--${STATE_TONE[s]}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const capitalizeFirst = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

// ---------- Folha inferior ----------

interface SheetProps {
  title: string;
  /** Esconde o título na tela; ele continua sendo o nome da folha para leitor de tela. */
  hideTitle?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** No celular sobe da base da tela; em telas grandes vira uma janela no centro. Fecha com Esc ou toque fora. */
export function Sheet({ title, hideTitle, onClose, children }: SheetProps) {
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
            <h2 className={hideTitle ? 'visually-hidden' : 'sheet__title'}>{title}</h2>
            {/* No celular fecha-se puxando a aba para baixo; o botão só aparece em tela grande (e para leitor de tela). */}
            <button type="button" className="sheet__close" onClick={() => closeRef.current()} onPointerDown={(event) => event.stopPropagation()} aria-label={t('Fechar')}>
              <XIcon />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
