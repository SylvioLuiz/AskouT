import { useEffect, useRef } from 'react';

const ITEM = 42; // altura de cada número, em px (igual no CSS)

type WheelProps = {
  label: string;
  values: readonly number[];
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
};

/**
 * Roleta de números, no estilo do relógio do iPhone: arraste para cima ou para baixo e o número do meio vale.
 * Usa rolagem nativa com "snap", então o dedo tem a inércia do sistema. Também funciona com as setas do teclado.
 */
export function Wheel({ label, values, value, onChange, format = String }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const index = Math.max(0, values.indexOf(value));

  // Quando o valor muda por fora (ajuste de limite, por exemplo), a roleta acompanha.
  const mounted = useRef(false);
  const programmatic = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - index * ITEM) > 1) {
      // Rolagem feita por nós não pode ser lida de volta como se fosse o dedo.
      if (mounted.current) {
        window.clearTimeout(programmatic.current);
        programmatic.current = window.setTimeout(() => (programmatic.current = undefined), 500);
      }
      el.scrollTo({ top: index * ITEM, behavior: mounted.current ? 'smooth' : 'instant' });
    }
    mounted.current = true;
  }, [index]);

  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(programmatic.current); }, []);

  function onScroll() {
    window.clearTimeout(timer.current);
    if (programmatic.current !== undefined) return;
    // Só decide quando a rolagem para: durante a inércia o número do meio muda o tempo todo.
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
      const next = values[i];
      if (next !== undefined && next !== value) onChange(next);
    }, 90);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = values[Math.min(values.length - 1, Math.max(0, index + step))];
    if (next !== undefined) onChange(next);
  }

  return (
    <div className="wheel" role="group" aria-label={label}>
      <div
        className="wheel__list"
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={values[0]}
        aria-valuemax={values[values.length - 1]}
        aria-valuenow={value}
        aria-valuetext={format(value)}
      >
        {values.map((v) => (
          <button
            key={v}
            type="button"
            tabIndex={-1}
            className={`wheel__item${v === value ? ' wheel__item--on' : ''}`}
            onClick={() => onChange(v)}
            aria-hidden="true"
          >
            {format(v)}
          </button>
        ))}
      </div>
    </div>
  );
}
