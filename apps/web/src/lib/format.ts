const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** 950 -> "950"; 1200 -> "1,2 mil". */
export function formatCount(value: number): string {
  return compact.format(value);
}

/** Segundos inteiros até o instante `iso`, nunca negativos. */
export function secondsUntil(iso: string, nowMs: number): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - nowMs) / 1000));
}

/** 75 -> "1:15"; 9 -> "0:09". */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
