/**
 * Live Activity da chegada do amigo no iPhone: se a pessoa fechou e depois volta ao NOW (ou ao encontro), abre de
 * novo depois de alguns segundos. Só pede ao servidor quando o próprio iPhone diz que ela não está na tela, para não
 * abrir duas iguais. No Android e no navegador a ponte não responde e nada acontece.
 */
import type { FlashMatch } from './types.ts';

/** O mesmo `tag` que o servidor usa na chegada (apps/api FlashService, arrivalTag). */
export const arrivalTag = (inviteId: string, sharerId: string): string => `arrival:${inviteId}:${sharerId}`;

/** Não pergunta de novo pelo mesmo encontro antes disto (abrir a tela várias vezes seguidas). */
export const REOPEN_EVERY_MS = 30_000;

export async function reopenClosedArrivals(
  matches: readonly FlashMatch[],
  deps: { showing: ((tag: string) => Promise<boolean | undefined>) | undefined; reopen: (inviteId: string) => Promise<unknown>; asked: Map<string, number>; nowMs: number },
): Promise<string[]> {
  if (!deps.showing) return [];
  const reopened: string[] = [];
  for (const m of matches) {
    if (!m.themArrival) continue;
    const last = deps.asked.get(m.inviteId);
    if (last !== undefined && deps.nowMs - last < REOPEN_EVERY_MS) continue;
    deps.asked.set(m.inviteId, deps.nowMs);
    const showing = await deps.showing(arrivalTag(m.inviteId, m.other.userId)).catch(() => undefined);
    if (showing !== false) continue;
    await deps.reopen(m.inviteId).catch(() => undefined);
    reopened.push(m.inviteId);
  }
  return reopened;
}
