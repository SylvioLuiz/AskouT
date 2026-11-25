import type { CoreDeps } from './ports.ts';
import type { PostRecord } from './types.ts';

/**
 * Admins de evento criado por pessoa.
 * - O dono promove quem vai ao evento (ou aceitou o convite) e tira depois; o dono continua dono.
 * - O admin pode sair do papel sozinho.
 * - O admin convida pessoas (também em evento privado, pela folha de convidar ou mandando o cartão numa conversa),
 *   cancela os convites que ele mesmo mandou e edita o evento (nome, data, local, descrição, configurações e capa).
 * - O admin não apaga nem arquiva o evento, não muda quem vê (público ou privado) e não mexe nos admins.
 */

/** Quantos admins um evento pode ter, além do dono. */
export const EVENT_ADMINS_MAX = 10;

/** Quem organiza o evento: o dono ou um admin. */
export async function canManageEvent(deps: Pick<CoreDeps, 'posts'>, userId: string, post: Pick<PostRecord, 'id' | 'authorId'>): Promise<boolean> {
  return post.authorId === userId || (await deps.posts.isEventAdmin(post.id, userId));
}
