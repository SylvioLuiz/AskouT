import type { CoreDeps } from './ports.ts';
import type { EventRef } from './types.ts';

/**
 * Mudanças de data de um evento (do local ou de pessoa) que avisam quem vai.
 * - Adiar: o evento fica "Adiado" (sem nova data). A data antiga continua guardada, mas o app não a mostra como certa
 *   e os lembretes param.
 * - Nova data: mudar o início (na edição) tira o adiado e avisa a nova data.
 * - Tirar o adiado sem mudar a data: avisa que o evento segue na data guardada.
 * Quem recebe: quem confirmou "Eu vou" e, no evento de pessoa, quem aceitou o convite e o dono (se quem mudou foi um admin).
 * Quem fez a mudança não recebe.
 */

const WHEN = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const BATCH = 25;

export type EventChange = { kind: 'POSTPONED' } | { kind: 'RESCHEDULED'; startsAt: Date } | { kind: 'UNPOSTPONED'; startsAt: Date };

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

export async function notifyEventChange(
  deps: Pick<CoreDeps, 'eventRoom' | 'posts' | 'notifier' | 'clock'>,
  input: { ref: EventRef; title: string; ownerId: string | null; actorId: string | null; change: EventChange },
): Promise<void> {
  const { ref, change } = input;
  const users = await audience(deps, ref, input.ownerId, input.actorId);
  if (users.length === 0) return;
  const name = clip(input.title, 60);
  const title = change.kind === 'POSTPONED' ? `${name} foi adiado` : change.kind === 'UNPOSTPONED' ? `${name} não está mais adiado` : `${name} mudou de data`;
  const body =
    change.kind === 'POSTPONED' ? 'A nova data ainda vai ser definida. Avisamos quando sair.' : change.kind === 'UNPOSTPONED' ? `Continua em ${formatEventWhen(change.startsAt)}` : `Nova data: ${formatEventWhen(change.startsAt)}`;
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
