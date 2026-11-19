import { isEmoji } from './conversation-service.ts';
import type { ConversationService } from './conversation-service.ts';
import { validationError } from './errors.ts';
import type { EventPageService } from './event-page-service.ts';
import type { CoreDeps } from './ports.ts';

/**
 * Reagir a um story (como no Instagram): entre amigos, a reação chega como mensagem na conversa de vocês;
 * num story de evento de alguém que não é seu amigo, chega só como aviso (sino/push).
 */
export class StoryReactionService {
  private readonly deps: CoreDeps;
  private readonly eventPages: EventPageService;
  private readonly conversations: ConversationService;

  constructor(deps: CoreDeps, eventPages: EventPageService, conversations: ConversationService) {
    this.deps = deps;
    this.eventPages = eventPages;
    this.conversations = conversations;
  }

  async react(actorId: string, storyId: unknown, emoji: unknown, rawEventId?: unknown): Promise<{ sent: true; conversationId: string | null }> {
    if (!isEmoji(emoji)) throw validationError('Reação inválida', { emoji: 'Use um emoji' });
    const { authorId, eventUrl } = await this.eventPages.reactableStory(actorId, storyId, rawEventId);
    const friends = await this.deps.follows.listFriendIds(actorId);
    if (friends.includes(authorId)) {
      const { id } = await this.conversations.open(actorId, authorId);
      await this.conversations.send(actorId, id, { body: `Reagiu ao seu story: ${emoji}` });
      return { sent: true, conversationId: id };
    }
    const me = (await this.deps.users.findProfilesByIds([actorId]))[0];
    await this.deps.notifier.notify({
      userId: authorId,
      type: 'FEED_REACTION',
      title: `${me?.username ?? 'Alguém'} reagiu ${emoji} ao seu story`,
      body: 'Toque para ver o evento.',
      url: eventUrl,
      dedupeKey: `story-reaction:${String(storyId)}:${actorId}`,
      actorId,
    });
    return { sent: true, conversationId: null };
  }
}
