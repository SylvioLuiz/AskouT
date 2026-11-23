import type { CoreDeps } from './ports.ts';
import type { ConversationRecord } from './types.ts';

export type MessageRequestRole = 'INCOMING' | 'OUTGOING' | null;
/** Como uma mensagem chega: DIRECT = na caixa de conversas; REQUEST = em solicitações; NONE = não dá para enviar. */
export type MessageDelivery = 'DIRECT' | 'REQUEST' | 'NONE';

/**
 * Para onde vai a mensagem de `senderId` para `recipientId` na conversa 1 a 1 (como no Instagram):
 * - bloqueio em qualquer sentido: não dá;
 * - solicitação já aceita, quem recebe segue quem escreve, ou perfil público que aceita mensagens de qualquer pessoa: direto;
 * - quem escreve segue quem recebe (seguimento aceito), mas não é seguido de volta: vira solicitação;
 * - fora isso: não dá (é preciso seguir a pessoa).
 */
export async function messageDelivery(deps: CoreDeps, senderId: string, recipientId: string, conversation?: ConversationRecord): Promise<MessageDelivery> {
  const { follows, blocks, users, conversations } = deps;
  if (senderId === recipientId || (await blocks.existsEitherWay(senderId, recipientId))) return 'NONE';
  // Conversa pela página de um local: o local recebe de qualquer pessoa e o dono responde, sempre direto.
  if (conversation?.venueId || conversation?.acceptedAt) return 'DIRECT';
  const [back, forth] = await Promise.all([follows.get(recipientId, senderId), follows.get(senderId, recipientId)]);
  if (back?.status === 'ACCEPTED') return 'DIRECT';
  const [profile] = await users.findProfilesByIds([recipientId]);
  if (profile && !profile.isPrivate && (await conversations.getOpenDms(recipientId))) return 'DIRECT';
  return forth?.status === 'ACCEPTED' ? 'REQUEST' : 'NONE';
}

export function requestRole(conversation: ConversationRecord, actorId: string): MessageRequestRole {
  if (conversation.type !== 'DIRECT' || !conversation.requestToId) return null;
  return conversation.requestToId === actorId ? 'INCOMING' : 'OUTGOING';
}

/** Conversa 1 a 1 que já existe entre as duas pessoas. */
export async function directBetween(deps: CoreDeps, a: string, b: string): Promise<ConversationRecord | undefined> {
  return deps.conversations.findDirect(a, b);
}
