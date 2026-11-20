import { tasteIconPaths } from '../lib/taste-icons.ts';
import { useThemes } from '../lib/use-themes.ts';
import type { ThemeId } from '../lib/themes.ts';

/** Botões dos gostos de rolê (cadastro e configurações): cada um liga e desliga. */
export function TastePicker({ chosen, onToggle, disabled }: { chosen: ReadonlySet<ThemeId>; onToggle: (id: ThemeId) => void; disabled?: boolean }) {
  const THEMES = useThemes();
  return (
    <ul className="onb__themes">
      {THEMES.map((theme) => {
        const on = chosen.has(theme.id);
        return (
          <li key={theme.id}>
            <button type="button" className={`onb__theme${on ? ' onb__theme--on' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => onToggle(theme.id)}>
              <svg className="onb__themeicon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                {tasteIconPaths(theme.icon).map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
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
