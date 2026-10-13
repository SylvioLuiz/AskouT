import type { Interval } from './types.ts';

export function isValidInterval(i: Interval): boolean {
  return Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}

/** Une intervalos sobrepostos ou contíguos. Ignora intervalos inválidos. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter(isValidInterval).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** Quantos ms de `target` são cobertos por `merged` (que deve estar mesclado). */
export function coveredDuration(merged: Interval[], target: Interval): number {
  let total = 0;
  for (const m of merged) {
    const s = Math.max(m.start, target.start);
    const e = Math.min(m.end, target.end);
    if (e > s) total += e - s;
  }
  return total;
}

function tzOffsetMs(instant: number, timeZone: string): number {
  const t = Math.floor(instant / 1000) * 1000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - t;
}

/** Converte um horário local (no fuso IANA informado) para epoch UTC, respeitando horário de verão. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset1 = tzOffsetMs(guess, timeZone);
  let utc = guess - offset1;
  const offset2 = tzOffsetMs(utc, timeZone);
  if (offset2 !== offset1) utc = guess - offset2;
  return utc;
}
