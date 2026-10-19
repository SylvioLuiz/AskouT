import type { EventStoryGroup } from './types.ts';

/** Quanto tempo uma foto fica na tela antes de passar sozinha. */
export const STORY_PHOTO_MS = 5000;

export interface StoryPos {
  group: number;
  item: number;
}

/** Próximo story (do mesmo grupo e depois do próximo grupo). `null` no último: é hora de fechar. */
export function nextStory(groups: readonly Pick<EventStoryGroup, 'items'>[], pos: StoryPos): StoryPos | null {
  const group = groups[pos.group];
  if (!group) return null;
  if (pos.item + 1 < group.items.length) return { group: pos.group, item: pos.item + 1 };
  if (pos.group + 1 < groups.length) return { group: pos.group + 1, item: 0 };
  return null;
}

/** Story anterior; no primeiro, volta para o começo dele. */
export function prevStory(groups: readonly Pick<EventStoryGroup, 'items'>[], pos: StoryPos): StoryPos {
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
