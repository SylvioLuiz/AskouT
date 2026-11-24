import type { CoreDeps } from './ports.ts';

/**
 * Quem está no grupo de um evento criado por pessoa.
 * - Convidado só entra no grupo quando aceita o convite ("Eu vou"); até lá vota a data pela votação, fora do grupo.
 * - Em evento público, quem marca "Eu vou" sem convite também entra.
 * - Quem desmarca "Eu vou" sai do grupo (continua convidado e, com a data em votação, continua votando).
 * - O dono do grupo pode continuar adicionando amigos à mão, pelo grupo.
 */

type Deps = Pick<CoreDeps, 'conversations' | 'meetups' | 'blocks' | 'users' | 'notifier' | 'ids' | 'clock'>;

/** Limite de pessoas num grupo, contando quem criou (o mesmo da conversa em grupo). */
export const EVENT_GROUP_CAPACITY = 16;

/** Coloca a pessoa nos grupos do evento em que ela ainda não está. Grupo cheio ou com bloqueio com o dono do grupo fica de fora. */
export async function joinEventGroups(deps: Deps, postId: string, userId: string): Promise<string[]> {
  const { conversations, blocks, clock, ids, notifier } = deps;
  const joined: string[] = [];
  for (const id of await conversations.groupIdsForEventPost(postId)) {
    const conversation = await conversations.findById(id);
    if (conversation?.type !== 'GROUP') continue;
    const members = (await conversations.participantIds(id)) ?? [];
    if (members.includes(userId) || members.length >= EVENT_GROUP_CAPACITY) continue;
    if (conversation.ownerId && conversation.ownerId !== userId && (await blocks.existsEitherWay(userId, conversation.ownerId))) continue;
    const now = clock.now();
    await conversations.addParticipant(id, userId, now);
    const name = await nameOf(deps, userId);
    await conversations.addMessage({ id: ids.next(), conversationId: id, senderId: userId, kind: 'SYSTEM', body: `${name} vai ao evento e entrou no grupo`, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
    await notifier.notify({ userId, type: 'MESSAGE', title: conversation.name ?? 'Grupo do evento', body: 'Você entrou no grupo do evento', url: `/conversas/${id}`, dedupeKey: `msg:${id}` });
    joined.push(id);
  }
  return joined;
}

/** Tira a pessoa dos grupos do evento (menos do grupo que ela mesma criou). A votação de data, se houver, continua com ela. */
export async function leaveEventGroups(deps: Deps, postId: string, userId: string): Promise<void> {
  const { conversations, clock, ids } = deps;
  for (const id of await conversations.groupIdsForEventPost(postId)) {
    const conversation = await conversations.findById(id);
    if (conversation?.type !== 'GROUP' || conversation.ownerId === userId) continue;
    if (!((await conversations.participantIds(id)) ?? []).includes(userId)) continue;
    const now = clock.now();
    const name = await nameOf(deps, userId);
    await conversations.addMessage({ id: ids.next(), conversationId: id, senderId: userId, kind: 'SYSTEM', body: `${name} não vai mais ao evento e saiu do grupo`, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
    await conversations.removeParticipant(id, userId);
    await deps.meetups.declineAllFor(id, userId, now);
  }
}

async function nameOf(deps: Deps, userId: string): Promise<string> {
  const p = await deps.users.findProfileById(userId);
  return p?.displayName ?? p?.username ?? 'Alguém';
}
