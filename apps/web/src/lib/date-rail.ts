/** Régua de datas do Início: meses do atual (topo) até o do post mais antigo (base), como o índice de letras dos contatos. */
export interface RailMonth {
  year: number;
  /** 0 a 11. */
  month: number;
}

/** Meses do mais recente ao mais antigo. Vazio quando tudo cabe no mês atual (não há para onde pular). */
export function railMonths(now: Date, oldestIso: string | null | undefined): RailMonth[] {
  if (!oldestIso) return [];
  const oldest = new Date(oldestIso);
  if (Number.isNaN(oldest.getTime())) return [];
  const out: RailMonth[] = [];
  let y = now.getFullYear();
  let m = now.getMonth();
  const stop = oldest.getFullYear() * 12 + oldest.getMonth();
  while (y * 12 + m >= stop && out.length < 600) {
    out.push({ year: y, month: m });
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return out.length > 1 ? out : [];
}

/** Posição (0 no topo, 1 na base) para o índice do mês. */
export function railIndexAt(fraction: number, count: number): number {
  if (count <= 0) return 0;
  const f = Math.min(1, Math.max(0, fraction));
  return Math.min(count - 1, Math.floor(f * count));
}

/** Índice do mês de uma data na régua (preso às pontas). */
export function railIndexOf(months: RailMonth[], at: Date): number {
  if (months.length === 0) return 0;
  const first = months[0]!;
  const diff = first.year * 12 + first.month - (at.getFullYear() * 12 + at.getMonth());
  return Math.min(months.length - 1, Math.max(0, diff));
}

/** Instante logo depois do fim do mês (o `before` do feed): mostra esse mês e os anteriores. */
export function railBefore(month: RailMonth): string {
  return new Date(month.year, month.month + 1, 1).toISOString();
}
