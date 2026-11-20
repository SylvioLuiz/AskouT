import type { GoingEvent } from './types.ts';

const DEFAULT_LENGTH_MS = 3 * 3_600_000;

export interface GoingTarget {
  id: string;
  startsAt: string;
  /** Sem fim, vale 3 horas depois do começo. */
  endsAt?: string | undefined;
}

function range(startsAt: string, endsAt: string | undefined): { start: number; end: number } | undefined {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return undefined;
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  return { start, end: Number.isFinite(end) && end > start ? end : start + DEFAULT_LENGTH_MS };
}

/**
 * Os eventos em que a pessoa já disse "Eu vou" e que se sobrepõem ao horário de `target` (o mesmo evento não conta, e
 * emendar um no outro, terminando às 22h e começando às 22h, não é conflito). Em ordem de começo.
 */
export function findConflicts(target: GoingTarget, going: readonly GoingEvent[]): GoingEvent[] {
  const mine = range(target.startsAt, target.endsAt);
  if (!mine) return [];
  return going
    .filter((other) => {
      if (other.id === target.id) return false;
      const theirs = range(other.startsAt, other.endsAt);
      return theirs !== undefined && mine.start < theirs.end && theirs.start < mine.end;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : 1));
}
