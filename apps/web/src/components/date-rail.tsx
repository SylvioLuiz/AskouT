import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { railIndexAt, railIndexOf } from '../lib/date-rail.ts';
import type { RailMonth } from '../lib/date-rail.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';

const monthFmt = new Intl.DateTimeFormat(intlLocale(), { month: 'short', year: 'numeric' });
const label = (m: RailMonth) => monthFmt.format(new Date(m.year, m.month, 15));

/** Data do primeiro item do feed que está na tela (cada item marca `data-feed-at`). */
function visibleAt(): Date | undefined {
  const top = 80;
  for (const node of document.querySelectorAll<HTMLElement>('[data-feed-at]')) {
    if (node.getBoundingClientRect().bottom > top) {
      const at = new Date(node.dataset['feedAt'] ?? '');
      return Number.isNaN(at.getTime()) ? undefined : at;
    }
  }
  return undefined;
}

/**
 * Régua de datas na borda direita, como o índice de letras dos contatos: aparece ao rolar o feed;
 * encostar e arrastar mostra o mês, soltar pula para ele.
 */
export function DateRail({ months, onJump }: { months: RailMonth[]; onJump: (index: number) => void }) {
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState<number | undefined>();
  const [at, setAt] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const dragging = drag !== undefined;

  useEffect(() => {
    const onScroll = () => {
      const seen = visibleAt();
      if (seen) setAt(railIndexOf(months, seen));
      if (window.scrollY < 400) return;
      setShown(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setShown(false), 1800);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(hideTimer.current);
    };
  }, [months]);

  if (months.length === 0) return null;

  function indexFor(clientY: number): number {
    const box = rail.current?.getBoundingClientRect();
    if (!box || box.height === 0) return 0;
    return railIndexAt((clientY - box.top) / box.height, months.length);
  }
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.clearTimeout(hideTimer.current);
    setShown(true);
    setDrag(indexFor(event.clientY));
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const next = indexFor(event.clientY);
    if (next !== drag && 'vibrate' in navigator) navigator.vibrate?.(4);
    setDrag(next);
  }
  function up() {
    if (drag === undefined) return;
    const chosen = drag;
    setDrag(undefined);
    setAt(chosen);
    hideTimer.current = window.setTimeout(() => setShown(false), 1200);
    onJump(chosen);
  }

  const index = drag ?? at;
  const pos = months.length > 1 ? index / (months.length - 1) : 0;
  // Marcas de ano ao longo da régua (só enquanto arrasta), como as letras dos contatos.
  const years = months.flatMap((m, i) => (i === 0 || m.month === 11 ? [{ i, year: m.year }] : []));
  return (
    <div
      ref={rail}
      className={`daterail${shown || dragging ? ' daterail--shown' : ''}${dragging ? ' daterail--drag' : ''}`}
      role="slider"
      aria-label={t('Ir para uma data')}
      aria-valuemin={0}
      aria-valuemax={months.length - 1}
      aria-valuenow={index}
      aria-valuetext={label(months[index]!)}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(undefined)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = Math.min(months.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
          setAt(next);
          onJump(next);
        }
      }}
    >
      {dragging ? (
        <ol className="daterail__years" aria-hidden="true">
          {years.map((y) => (
            <li key={y.year} style={{ top: `${(y.i / Math.max(1, months.length - 1)) * 100}%` }}>{y.year}</li>
          ))}
        </ol>
      ) : null}
      <span className="daterail__thumb" style={{ top: `${pos * 100}%` }} aria-hidden="true">
        {dragging ? <span className="daterail__bubble">{label(months[index]!)}</span> : null}
      </span>
    </div>
  );
}
