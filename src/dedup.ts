import { createHash } from 'node:crypto';
import type { Candidate } from './types.ts';

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Chave estável: mesmo título, local e dia (fuso de São Paulo) = mesmo evento, venha de que fonte vier. */
export function dedupKey(c: Candidate): string {
  const day = c.startsAt ? new Date(Date.parse(c.startsAt) - 3 * 3_600_000).toISOString().slice(0, 10) : 'sem-data';
  return createHash('sha256').update(`${norm(c.title)}|${norm(c.venueName ?? '')}|${day}`).digest('hex').slice(0, 32);
}
