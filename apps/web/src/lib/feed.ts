import type { FeedPolicy, FeedPost, FeedReactions } from './types.ts';
import { t } from './i18n/index.ts';

/** O mesmo limite de texto que a API aceita numa publicação do feed. */
export const FEED_BODY_MAX = 1000;
export const FEED_COMMENT_MAX = 500;
export const FEED_IMAGES_MAX = 5;
/** As reações que aparecem para escolher (a API aceita qualquer emoji). */
export const FEED_REACTIONS = ['❤️', '😂', '🔥', '😮', '😢', '👍'] as const;

export const FEED_POLICIES: readonly FeedPolicy[] = ['OPEN', 'MODERATED', 'OWNER_ONLY'];

/** Nome e explicação de cada regra de publicação, como o dono escolhe. */
export function policyLabel(policy: FeedPolicy): { title: string; hint: string } {
  if (policy === 'OPEN') return { title: t('Aberto a todos'), hint: t('Quem vê a página publica na hora.') };
  if (policy === 'MODERATED') return { title: t('Com aprovação'), hint: t('Todos podem enviar, mas só aparece depois que você aprova.') };
  return { title: t('Só eu'), hint: t('Todos veem e comentam, mas só você publica.') };
}

/** O que quem visita entende sobre poder publicar aqui. */
export function policyNote(s: { policy: FeedPolicy; hasModerator: boolean; isModerator: boolean }): string {
  if (!s.hasModerator) return t('Esta página ainda não tem responsável, então ninguém publica no feed por enquanto.');
  if (s.isModerator) return `${policyLabel(s.policy).title}: ${policyLabel(s.policy).hint}`;
  if (s.policy === 'OPEN') return t('Qualquer pessoa pode publicar aqui.');
  if (s.policy === 'MODERATED') return t('Você pode publicar; quem organiza aprova antes de aparecer.');
  return t('Só quem organiza publica aqui, mas você pode comentar e reagir.');
}

/** Aplica, na hora, a minha reação (ou a retirada dela, com `null`) antes da resposta do servidor. */
export function applyReaction(current: FeedReactions, emoji: string | null): FeedReactions {
  const counts = new Map(current.counts.map((c) => [c.emoji, c.count] as const));
  if (current.mine) {
    const left = (counts.get(current.mine) ?? 1) - 1;
    if (left > 0) counts.set(current.mine, left);
    else counts.delete(current.mine);
  }
  if (emoji) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  const order = (e: string) => {
    const i = current.counts.findIndex((c) => c.emoji === e);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return {
    mine: emoji,
    counts: [...counts].map(([e, count]) => ({ emoji: e, count })).sort((a, b) => b.count - a.count || order(a.emoji) - order(b.emoji)),
  };
}

/** Total de reações e os (até 3) emojis mais usados, para a linha de resumo da publicação. */
export function reactionSummary(r: FeedReactions): { total: number; top: string[] } {
  return { total: r.counts.reduce((sum, c) => sum + c.count, 0), top: r.counts.slice(0, 3).map((c) => c.emoji) };
}

/** Junta a próxima página da rolagem sem repetir o que já está na tela. */
export function appendPage(current: FeedPost[], next: FeedPost[]): FeedPost[] {
  const seen = new Set(current.map((p) => p.id));
  return [...current, ...next.filter((p) => !seen.has(p.id))];
}

export function commentCountLabel(n: number): string {
  return n === 1 ? t('1 comentário') : t('{count} comentários', { count: n });
}
