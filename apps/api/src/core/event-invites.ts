import type { CoreDeps } from './ports.ts';
import type { PostRecord } from './types.ts';
import { canManageEvent } from './event-admins.ts';

/**
 * Convites de evento criado por pessoa.
 * - Marcar alguém na criação do evento já é convidar.
 * - Mandar o cartão do evento numa conversa convida quem está nela (vale o primeiro convite: fica registrado quem convidou).
 * - Evento privado: o convite do dono (ou de um admin do evento) também cria a marcação (a pessoa aceita para o evento ir para o perfil dela).
 * - Evento público: segue o fluxo normal (a pessoa abre o cartão e marca "Eu vou"); só registra quem convidou.
 */

type Deps = Pick<CoreDeps, 'posts' | 'conversations' | 'blocks' | 'clock'>;

/** Quem foi convidado (ou recebeu o cartão numa conversa) abre o evento, mesmo sem seguir o dono; evento privado só abre assim. Admin do evento também abre. */
export async function canOpenByInvite(deps: Pick<CoreDeps, 'posts' | 'conversations'>, userId: string, postId: string): Promise<boolean> {
  return (await deps.posts.isInvited(postId, userId)) || (await deps.posts.isEventAdmin(postId, userId)) || (await deps.conversations.hasPostEventAccess(userId, postId));
}

/** O cartão do evento foi enviado numa conversa: quem está nela (menos quem enviou, o dono e quem tem bloqueio) vira convidado. */
export async function recordCardInvites(deps: Deps, senderId: string, post: Pick<PostRecord, 'id' | 'authorId' | 'eventPrivate'>, conversationId: string): Promise<string[]> {
  const { posts, conversations, blocks, clock } = deps;
  const related = new Set(await blocks.listRelatedIds(senderId));
  const members = ((await conversations.participantIds(conversationId)) ?? []).filter((id) => id !== senderId && id !== post.authorId && !related.has(id));
  if (members.length === 0) return [];
  const now = clock.now();
  const added = await posts.addInvites(post.id, members, senderId, now);
  // Evento privado: só o dono e os admins enviam, e o convite vira marcação (quem já respondeu a uma marcação continua como respondeu).
  if (post.eventPrivate && (await canManageEvent(deps, senderId, post))) await posts.createTags(post.id, members, now);
  return added;
}
