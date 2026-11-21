/** Respostas a comentários: um nível só, sempre debaixo do comentário de cima da conversa. */

interface Threadable {
  id: string;
  parentId?: string | null;
}

export interface ThreadRow<T> {
  comment: T;
  /** Resposta: aparece recuada, debaixo do comentário de cima. */
  reply: boolean;
}

/**
 * Põe cada resposta logo depois do comentário de cima (e das respostas anteriores a ele), mantendo a ordem de chegada.
 * Resposta cujo comentário de cima não está na lista aparece como comentário comum.
 */
export function threadComments<T extends Threadable>(items: readonly T[]): ThreadRow<T>[] {
  const tops = new Set(items.filter((c) => !c.parentId).map((c) => c.id));
  const replies = new Map<string, T[]>();
  for (const c of items) {
    if (c.parentId && tops.has(c.parentId)) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  }
  const out: ThreadRow<T>[] = [];
  for (const c of items) {
    if (c.parentId && tops.has(c.parentId)) continue;
    out.push({ comment: c, reply: false });
    for (const r of replies.get(c.id) ?? []) out.push({ comment: r, reply: true });
  }
  return out;
}

/** Tira um comentário da lista; as respostas dele viram comentários comuns (como faz o servidor). */
export function removeComment<T extends Threadable>(items: readonly T[], id: string): T[] {
  return items.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, parentId: null } : c));
}

/** Texto inicial ao responder: marca a pessoa com @ (menos quando é você mesmo ou quando o texto já começa com a marcação). */
export function replyPrefill(current: string, username: string | undefined, mine: boolean): string {
  if (!username || mine) return current;
  const tag = `@${username} `;
  return current.startsWith(tag) ? current : tag + current.replace(/^@[\w.]+\s+/, '');
}
