import { isEmoji } from './conversation-service.ts';
import type { ConversationService } from './conversation-service.ts';
import { validationError } from './errors.ts';
import type { EventPageService } from './event-page-service.ts';
import type { CoreDeps } from './ports.ts';

/** Tamanho máximo da resposta a um story. */
export const STORY_REPLY_MAX = 500;

/**
 * Interações com o story de outra pessoa (como no Instagram):
 * - reagir com emoji e responder com texto: entre amigos, chega como mensagem na conversa de vocês;
 *   num story de evento de alguém que não é seu amigo (conversa só entre amigos), chega como aviso (sino/push);
 * - curtir (coração): fica guardado e quem publicou recebe um aviso, sem virar mensagem.
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
    return this.deliver(actorId, storyId, rawEventId, {
      message: `Reagiu ao seu flash: ${emoji}`,
      title: (name) => `${name} reagiu ${emoji} ao seu flash`,
      body: 'Toque para ver o evento.',
      dedupe: 'story-reaction',
    });
  }

  /** Resposta em texto. Entre amigos vai para a conversa; senão, o texto chega no aviso. */
  async reply(actorId: string, storyId: unknown, rawText: unknown, rawEventId?: unknown): Promise<{ sent: true; conversationId: string | null }> {
    const text = typeof rawText === 'string' ? rawText.replace(/\r\n?/g, '\n').trim() : '';
    if (text === '' || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw validationError('Escreva uma mensagem', { text: 'Escreva uma mensagem' });
    if ([...text].length > STORY_REPLY_MAX) throw validationError('Mensagem muito longa', { text: `Use até ${STORY_REPLY_MAX} caracteres` });
    return this.deliver(actorId, storyId, rawEventId, {
      message: `Respondeu ao seu flash: ${text}`,
      title: (name) => `${name} respondeu ao seu flash`,
      body: text.length > 140 ? `${text.slice(0, 139)}…` : text,
      // Cada resposta é um aviso próprio.
      dedupe: `story-reply:${this.deps.ids.next()}`,
    });
  }

  /** Coração: guarda a curtida e avisa quem publicou só na primeira vez. */
  async like(actorId: string, storyId: unknown, liked: unknown, rawEventId?: unknown): Promise<{ liked: boolean }> {
    if (typeof liked !== 'boolean') throw validationError('Valor inválido', { liked: 'Use true ou false' });
    const { authorId, eventUrl } = await this.eventPages.reactableStory(actorId, storyId, rawEventId);
    const id = String(storyId);
    const changed = await this.deps.eventRoom.setStoryLike(id, actorId, liked, this.deps.clock.now());
    if (changed && liked) {
      const me = (await this.deps.users.findProfilesByIds([actorId]))[0];
      await this.deps.notifier.notify({
        userId: authorId,
        type: 'FEED_REACTION',
        title: `${me?.username ?? 'Alguém'} curtiu seu flash`,
        body: 'Toque para ver o evento.',
        url: eventUrl,
        dedupeKey: `story-like:${id}:${actorId}`,
        actorId,
      });
    }
    return { liked };
  }

  /** Registra que você viu o story de outra pessoa (uma vez). Quem publicou vê só a contagem. */
  async view(actorId: string, storyId: unknown, rawEventId?: unknown): Promise<{ viewed: true }> {
    await this.eventPages.reactableStory(actorId, storyId, rawEventId);
    await this.deps.eventRoom.recordStoryView(String(storyId), actorId, this.deps.clock.now());
    return { viewed: true };
  }

  private async deliver(
    actorId: string,
    storyId: unknown,
    rawEventId: unknown,
    content: { message: string; title: (name: string) => string; body: string; dedupe: string },
  ): Promise<{ sent: true; conversationId: string | null }> {
    const { authorId, eventUrl } = await this.eventPages.reactableStory(actorId, storyId, rawEventId);
    const friends = await this.deps.follows.listFriendIds(actorId);
    if (friends.includes(authorId)) {
      const { id } = await this.conversations.open(actorId, authorId);
      await this.conversations.send(actorId, id, { body: content.message });
      return { sent: true, conversationId: id };
    }
    const me = (await this.deps.users.findProfilesByIds([actorId]))[0];
    await this.deps.notifier.notify({
      userId: authorId,
      type: 'FEED_REACTION',
      title: content.title(me?.username ?? 'Alguém'),
      body: content.body,
      url: eventUrl,
      dedupeKey: content.dedupe === 'story-reaction' ? `story-reaction:${String(storyId)}:${actorId}` : content.dedupe,
      actorId,
    });
    return { sent: true, conversationId: null };
  }
}
