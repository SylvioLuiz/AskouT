import { KINDS } from '../lib/explore.ts';
import type { EventKind } from '../lib/types.ts';
import { EventKindIcon } from './icons.tsx';

/** Escolha do tipo do evento: decide o ícone no círculo da capa. */
export function EventKindPicker({ value, onChange }: { value: EventKind; onChange: (kind: EventKind) => void }) {
  return (
    <fieldset className="kindpick">
      <legend className="kindpick__legend">Tipo do evento</legend>
      <ul className="kindpick__list">
        {KINDS.map((k) => (
          <li key={k.id}>
            <button type="button" className="fchip kindpick__chip" aria-pressed={value === k.id} onClick={() => onChange(k.id)}>
              <EventKindIcon kind={k.id} />
              {k.label}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
