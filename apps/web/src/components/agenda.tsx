import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { addDays, addMonths, dayChip, dayLongLabel, monthLabel, monthShortLabel, monthStart, monthWeeks, weekdayInitials, LEVEL_LABEL, PARTICIPANT_LABEL, STATE_LABEL } from '../lib/agenda.ts';
import type { CompatibilityLevel, ParticipantStatus, SlotState } from '../lib/types.ts';
import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, HalfIcon, XIcon } from './icons.tsx';
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
  /** Vai para o mês anterior (-1) ou o próximo (+1). */
  onMonth: (by: number) => void;
  /** Abre o calendário do mês para pular para qualquer data. */
  onOpenCalendar: () => void;
}

/** Faixa horizontal que rola com o dedo; o dia escolhido desliza até o centro. Setas do teclado trocam o dia. */
export function DayStrip({ days, selected, today, onSelect, statesOf, eventsOf, onMonth, onOpenCalendar }: DayStripProps) {
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

  // Sem limite: passar do último dia do mês leva ao mês seguinte (e o contrário).
  function move(by: number) {
    onSelect(addDays(selected, by));
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
        <button type="button" className="daynav__month" onClick={onOpenCalendar} aria-haspopup="dialog" aria-label={t('{month}: abrir calendário', { month: capitalizeFirst(monthLabel(selected)) })}>
          <span aria-live="polite">{capitalizeFirst(monthLabel(selected))}</span>
          <ChevronDownIcon />
        </button>
        <div className="daynav__actions">
          {selected !== today ? (
            <button type="button" className="daynav__today" onClick={() => onSelect(today)}>
              {t('Hoje')}
            </button>
          ) : null}
          <button type="button" className="iconbtn daynav__arrow" onClick={() => onMonth(-1)} aria-label={t('Mês anterior')}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="iconbtn daynav__arrow" onClick={() => onMonth(1)} aria-label={t('Próximo mês')}>
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

// ---------- Calendário do mês ----------

interface MonthCalendarProps {
  selected: string;
  today: string;
  onSelect: (key: string) => void;
  /** Marcas do dia: evento confirmado e/ou horário marcado. */
  marksOf: (key: string) => { event: boolean; slot: boolean };
}

/**
 * Grade do mês, como no calendário do celular: setas (ou deslizar o dedo) trocam de mês sem limite,
 * e tocar no nome do mês mostra os 12 meses do ano, com setas para trocar de ano.
 */
export function MonthCalendar({ selected, today, onSelect, marksOf }: MonthCalendarProps) {
  const [month, setMonth] = useState(() => monthStart(selected));
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const year = Number(month.slice(0, 4));
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);

  function step(by: number) {
    setMonth((m) => addMonths(m, mode === 'months' ? by * 12 : by));
  }
  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    swipe.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  function onTouchEnd(event: React.TouchEvent) {
    const start = swipe.current;
    const touch = event.changedTouches[0];
    swipe.current = undefined;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(touch.clientY - start.y) * 1.5) return;
    step(dx < 0 ? 1 : -1);
  }

  const label = mode === 'months' ? String(year) : capitalizeFirst(monthLabel(month));
  return (
    <div className="mcal" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="mcal__bar">
        <button type="button" className="iconbtn daynav__arrow" onClick={() => step(-1)} aria-label={mode === 'months' ? t('Ano anterior') : t('Mês anterior')}>
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          className="mcal__title"
          aria-live="polite"
          aria-label={mode === 'months' ? t('{year}: voltar aos dias', { year }) : t('{month}: escolher outro mês ou ano', { month: label })}
          onClick={() => setMode(mode === 'days' ? 'months' : 'days')}
        >
          {label}
          <ChevronDownIcon />
        </button>
        <button type="button" className="iconbtn daynav__arrow" onClick={() => step(1)} aria-label={mode === 'months' ? t('Próximo ano') : t('Próximo mês')}>
          <ChevronRightIcon />
        </button>
      </div>

      {mode === 'months' ? (
        <div className="mcal__months" role="group" aria-label={t('Escolha o mês')}>
          {Array.from({ length: 12 }, (_, i) => {
            const key = `${year}-${String(i + 1).padStart(2, '0')}-01`;
            const isCurrent = key.slice(0, 7) === today.slice(0, 7);
            const isShown = key.slice(0, 7) === selected.slice(0, 7);
            return (
              <button
                key={key}
                type="button"
                className={`mcal__month${isShown ? ' mcal__month--selected' : ''}${isCurrent ? ' mcal__month--today' : ''}`}
                aria-pressed={isShown}
                aria-label={capitalizeFirst(monthLabel(key))}
                onClick={() => {
                  setMonth(key);
                  setMode('days');
                }}
              >
                {capitalizeFirst(monthShortLabel(key))}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mcal__grid" role="grid" aria-label={label}>
          <div className="mcal__row" role="row">
            {weekdayInitials().map((w, i) => (
              <span key={i} className="mcal__weekday" role="columnheader" aria-hidden="true">
                {w}
              </span>
            ))}
          </div>
          {monthWeeks(month).map((week) => (
            <div key={week[0]} className="mcal__row" role="row">
              {week.map((key) => {
                const outside = key.slice(0, 7) !== month.slice(0, 7);
                const marks = marksOf(key);
                const isSelected = key === selected;
                const isToday = key === today;
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    className={`mcal__day${outside ? ' mcal__day--outside' : ''}${isSelected ? ' mcal__day--selected' : ''}${isToday ? ' mcal__day--today' : ''}`}
                    aria-selected={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={`${dayLongLabel(key)}${isToday ? `, ${t('hoje')}` : ''}${marks.event ? `, ${t('tem evento')}` : ''}${marks.slot ? `, ${t('tem horário marcado')}` : ''}`}
                    onClick={() => onSelect(key)}
                  >
                    <span>{dayChip(key).day}</span>
                    <span className="mcal__marks" aria-hidden="true">
                      {marks.event ? <span className="daymark daymark--event" /> : null}
                      {marks.slot ? <span className="daymark daymark--ok" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="mcal__foot">
        <button
          type="button"
          className="daynav__today"
          onClick={() => onSelect(today)}
        >
          {t('Ir para hoje')}
        </button>
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
