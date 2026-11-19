import { useEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { t } from '../lib/i18n/index.ts';

/**
 * Código de N números em caixinhas, como nos apps com verificação em duas etapas: avança sozinho, apagar volta,
 * colar (ou o preenchimento automático do iPhone/Android) espalha os números e `onComplete` dispara quando enche.
 */
export function CodeBoxes({ value, onChange, onComplete, length = 6, disabled, error, autoFocus }: { value: string; onChange: (value: string) => void; onComplete?: (value: string) => void; length?: number; disabled?: boolean; error?: string | undefined; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // só ao montar
  }, []);

  // Código recusado (as caixas voltam vazias): volta o cursor para a primeira.
  useEffect(() => {
    if (error && value === '' && !disabled) refs.current[0]?.focus();
  }, [error, value, disabled]);

  function set(next: string, focusAt: number) {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    refs.current[Math.min(focusAt, length - 1)]?.focus();
    if (clean.length === length) onComplete?.(clean);
  }

  function typed(index: number, raw: string) {
    const added = raw.replace(/\D/g, '');
    if (added === '') return;
    // Vários números de uma vez (preenchimento automático): começa nesta caixa.
    const next = (value.slice(0, index) + added).slice(0, length);
    set(next, next.length);
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) set(value.slice(0, index) + value.slice(index + 1), index);
      else if (index > 0) set(value.slice(0, index - 1) + value.slice(index), index - 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (pasted === '') return;
    event.preventDefault();
    set(pasted, pasted.length);
  }

  return (
    <div className={`codeboxes${error ? ' codeboxes--error' : ''}`}>
      <div className="codeboxes__row" role="group" aria-label={t('Código de {length} números', { length })}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="codeboxes__box"
            value={digit}
            onChange={(e) => typed(i, e.target.value)}
            onKeyDown={(e) => keyDown(i, e)}
            onPaste={paste}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={i === 0 ? length : 1}
            disabled={disabled}
            aria-label={t('Número {n}', { n: i + 1 })}
            aria-invalid={error ? true : undefined}
          />
        ))}
      </div>
      {error ? <span className="field__error" role="alert">{error}</span> : null}
    </div>
  );
}
