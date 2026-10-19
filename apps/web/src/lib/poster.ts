const weekdayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

export interface DateTile {
  weekday: string;
  day: string;
  month: string;
}

const clean = (text: string) => text.replace('.', '').toUpperCase();

/** Dia do evento para o selo do cartaz: "SÁB", "25", "OUT". Vazio quando a data é inválida. */
export function dateTile(iso: string): DateTile | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { weekday: clean(weekdayFmt.format(d)), day: String(d.getDate()), month: clean(monthFmt.format(d)) };
}

/** "12 confirmados" / "1 confirmado" / "" quando ainda não se sabe. */
export function confirmedLabel(count: number | undefined): string {
  if (count === undefined) return '';
  if (count <= 0) return 'Seja o primeiro a confirmar';
  return count === 1 ? '1 confirmado' : `${count} confirmados`;
}
