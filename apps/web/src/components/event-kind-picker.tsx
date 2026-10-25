import { useId } from 'react';
import { KINDS } from '../lib/explore.ts';
import type { EventKind } from '../lib/types.ts';
import { ChevronDownIcon, EventKindIcon } from './icons.tsx';
import { t } from '../lib/i18n/index.ts';

/** Escolha do tipo do evento (lista suspensa): decide o ícone no círculo da capa. */
export function EventKindPicker({ value, onChange }: { value: EventKind; onChange: (kind: EventKind) => void }) {
  const id = useId();
  return (
    <div className="field kindpick">
      <label className="field__label" htmlFor={id}>
        {t('Tipo do evento')}
      </label>
      <div className="field__control kindpick__control">
        <span className="kindpick__icon" aria-hidden="true">
          <EventKindIcon kind={value} />
        </span>
        <select id={id} className="field__input kindpick__select" value={value} onChange={(e) => onChange(e.target.value as EventKind)}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="kindpick__chev" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </div>
    </div>
  );
}
