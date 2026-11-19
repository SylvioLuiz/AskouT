import type { EventStoryGroup } from './types.ts';

/** Quanto tempo uma foto fica na tela antes de passar sozinha. */
export const STORY_PHOTO_MS = 5000;

export interface StoryPos {
  group: number;
  item: number;
}

/** Próximo story (do mesmo grupo e depois do próximo grupo). `null` no último: é hora de fechar. */
export function nextStory(groups: readonly { items: readonly unknown[] }[], pos: StoryPos): StoryPos | null {
  const group = groups[pos.group];
  if (!group) return null;
  if (pos.item + 1 < group.items.length) return { group: pos.group, item: pos.item + 1 };
  if (pos.group + 1 < groups.length) return { group: pos.group + 1, item: 0 };
  return null;
}

/** Story anterior; no primeiro, volta para o começo dele. */
export function prevStory(groups: readonly { items: readonly unknown[] }[], pos: StoryPos): StoryPos {
  if (pos.item > 0) return { group: pos.group, item: pos.item - 1 };
  const before = groups[pos.group - 1];
  if (before) return { group: pos.group - 1, item: before.items.length - 1 };
  return { group: pos.group, item: 0 };
}

/** Primeiro story da pessoa (para abrir ao tocar no avatar). */
export function startOf(groups: readonly Pick<EventStoryGroup, 'author'>[], userId: string): StoryPos | null {
  const group = groups.findIndex((g) => g.author.userId === userId);
  return group < 0 ? null : { group, item: 0 };
}

/**
 * Fila para assistir a partir de uma pessoa, na ordem da faixa "Quem vai": começa nela, segue com quem vem depois,
 * dá a volta em quem vinha antes e termina com quem tem flash mas não aparece na faixa. Assim, ao acabar o flash
 * de uma pessoa, entram os das outras em seguida (em vez de fechar só porque ela era a última na ordem do servidor).
 */
export function queueFrom<G extends { author: { userId: string } }>(groups: readonly G[], order: readonly string[], userId: string): G[] {
  const byUser = new Map(groups.map((g) => [g.author.userId, g]));
  const shown = order.filter((id, i) => byUser.has(id) && order.indexOf(id) === i);
  const at = shown.indexOf(userId);
  const rotated = at < 0 ? shown : [...shown.slice(at), ...shown.slice(0, at)];
  const first = byUser.get(userId);
  const queue: G[] = first && at < 0 ? [first] : [];
  for (const id of rotated) queue.push(byUser.get(id)!);
  for (const g of groups) if (!queue.includes(g)) queue.push(g);
  return queue;
}
