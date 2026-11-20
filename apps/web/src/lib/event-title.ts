/** Separa o título nos primeiros dois pontos: "Festival X: Noite do Rock" -> ["Festival X:", "Noite do Rock"]. Sem ":" (ou nada depois dele), fica inteiro. */
export function splitEventTitle(title: string): { lead: string | null; rest: string } {
  const i = title.indexOf(':');
  if (i <= 0) return { lead: null, rest: title };
  const lead = title.slice(0, i + 1).trim();
  const rest = title.slice(i + 1).trim();
  if (rest === '') return { lead: null, rest: title };
  return { lead, rest };
}
