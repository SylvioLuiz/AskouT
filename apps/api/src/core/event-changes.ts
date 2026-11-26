import type { CoreDeps } from './ports.ts';
import type { EventRef } from './types.ts';

/**
 * Data de um evento (do local ou de pessoa): adiar e mudar a data avisam quem vai.
 * - Adiado sem nova data (pelo menu): o início guardado é o antigo e não aparece como certo; os lembretes param.
 * - Adiado com nova data (ao mudar a data, quem organiza diz que é adiamento): mostra "Adiado" com a nova data e a de
 *   antes riscada; os lembretes seguem pela nova data.
 * - Mudar a data sem ser adiamento só muda a data (e tira o adiado, se havia).
 * - Tirar o adiado sem mudar a data: o evento segue na data guardada.
 * Quem recebe: quem confirmou "Eu vou" e, no evento de pessoa, quem aceitou o convite e o dono (se quem mudou foi um admin).
 * Quem fez a mudança não recebe.
 */

const WHEN = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const BATCH = 25;

/** Estado do adiado: `at` nulo é não adiado; `from` nulo (com `at`) é nova data a definir. */
export interface PostponedState {
  at: Date | null;
  from: Date | null;
}

/** POSTPONED com `startsAt` nulo: adiado sem nova data. */
export type EventChange = { kind: 'POSTPONED'; startsAt: Date | null } | { kind: 'RESCHEDULED'; startsAt: Date } | { kind: 'UNPOSTPONED'; startsAt: Date };

/**
 * Novo estado do adiado e o que avisar.
 * `postponed`: true marca (ou mantém) adiado; false tira; ausente mantém, a não ser que a data mude (aí tira).
 * `dateSet`: adiando sem mudar a data, a data atual já é a nova (mostra "Adiado para"); sem ele, é adiado sem nova data.
 */
export function decidePostponed(
  current: { startsAt: Date; postponed: PostponedState },
  next: { startsAt: Date; postponed?: boolean; dateSet?: boolean },
  now: Date,
): { state: PostponedState; change: EventChange | null } {
  const rescheduled = next.startsAt.getTime() !== current.startsAt.getTime();
  const was = current.postponed.at !== null;
  const want = next.postponed ?? (rescheduled ? false : was);
  let state: PostponedState;
  if (!want) state = { at: null, from: null };
  else if (rescheduled) state = { at: was ? current.postponed.at : now, from: current.postponed.from ?? current.startsAt };
  else if (next.dateSet !== undefined) state = { at: was ? current.postponed.at : now, from: next.dateSet ? (current.postponed.from ?? current.startsAt) : null };
  else state = was ? current.postponed : { at: now, from: null };
  const tbdBefore = was && current.postponed.from === null;
  const tbdAfter = state.at !== null && state.from === null;
  let change: EventChange | null = null;
  if (rescheduled) change = want ? { kind: 'POSTPONED', startsAt: next.startsAt } : { kind: 'RESCHEDULED', startsAt: next.startsAt };
  else if (want && (!was || tbdBefore !== tbdAfter)) change = { kind: 'POSTPONED', startsAt: tbdAfter ? null : next.startsAt };
  else if (!want && was) change = { kind: 'UNPOSTPONED', startsAt: next.startsAt };
  return { state, change };
}

export function samePostponed(a: PostponedState, b: PostponedState): boolean {
  return (a.at?.getTime() ?? null) === (b.at?.getTime() ?? null) && (a.from?.getTime() ?? null) === (b.from?.getTime() ?? null);
}

function clip(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

export function formatEventWhen(at: Date): string {
  return WHEN.format(at).replace(',', '');
}

/** Quem deve saber da mudança: quem vai, quem aceitou o convite e o dono (sem quem mudou). */
async function audience(deps: Pick<CoreDeps, 'eventRoom' | 'posts'>, ref: EventRef, ownerId: string | null, actorId: string | null): Promise<string[]> {
  const ids = new Set((await deps.eventRoom.listGoing(ref)).map((g) => g.userId));
  if (ref.source === 'USER') {
    for (const t of await deps.posts.tagsFor([ref.id])) if (t.status === 'ACCEPTED') ids.add(t.userId);
  }
  if (ownerId) ids.add(ownerId);
  if (actorId) ids.delete(actorId);
  return [...ids];
}

export function changeMessage(title: string, change: EventChange): { title: string; body: string } {
  const name = clip(title, 60);
  switch (change.kind) {
    case 'POSTPONED':
      return change.startsAt
        ? { title: `${name} foi adiado`, body: `Nova data: ${formatEventWhen(change.startsAt)}` }
        : { title: `${name} foi adiado`, body: 'A nova data ainda vai ser definida. Avisamos quando sair.' };
    case 'UNPOSTPONED':
      return { title: `${name} não está mais adiado`, body: `Continua em ${formatEventWhen(change.startsAt)}` };
    case 'RESCHEDULED':
      return { title: `${name} mudou de data`, body: `Nova data: ${formatEventWhen(change.startsAt)}` };
  }
}

export async function notifyEventChange(
  deps: Pick<CoreDeps, 'eventRoom' | 'posts' | 'notifier' | 'clock'>,
  input: { ref: EventRef; title: string; ownerId: string | null; actorId: string | null; change: EventChange },
): Promise<void> {
  const { ref } = input;
  const users = await audience(deps, ref, input.ownerId, input.actorId);
  if (users.length === 0) return;
  const { title, body } = changeMessage(input.title, input.change);
  // Uma chave por mudança: um aviso de nova data chega mesmo com o de adiado ainda não lido.
  const dedupeKey = `event-update:${ref.id}:${deps.clock.now().getTime()}`;
  for (let i = 0; i < users.length; i += BATCH) {
    await Promise.all(
      users.slice(i, i + BATCH).map((userId) =>
        deps.notifier.notify({ userId, type: 'EVENT_UPDATE', title, body, url: `/eventos/${ref.id}`, dedupeKey, ...(input.actorId ? { actorId: input.actorId } : {}) }).catch(() => undefined),
      ),
    );
  }
}
