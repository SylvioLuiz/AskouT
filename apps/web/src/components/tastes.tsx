import { THEMES } from '../lib/themes.ts';
import type { ThemeId } from '../lib/themes.ts';

/** Botões dos gostos de rolê (cadastro e configurações): cada um liga e desliga. */
export function TastePicker({ chosen, onToggle, disabled }: { chosen: ReadonlySet<ThemeId>; onToggle: (id: ThemeId) => void; disabled?: boolean }) {
  return (
    <ul className="onb__themes">
      {THEMES.map((theme) => {
        const on = chosen.has(theme.id);
        return (
          <li key={theme.id}>
            <button type="button" className={`onb__theme${on ? ' onb__theme--on' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => onToggle(theme.id)}>
              <strong>{theme.label}</strong>
              <span>{theme.hint}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Liga ou desliga um gosto num conjunto, sem mexer no original. */
export function toggleTaste(current: ReadonlySet<ThemeId>, id: ThemeId): Set<ThemeId> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
