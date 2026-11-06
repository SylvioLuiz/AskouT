import type { NotificationType } from './types.ts';

/** Filtros da tela de notificações (fileira de chips, como no Instagram). `all` não filtra. */
export const NOTIFICATION_CATEGORIES = ['all', 'mentions', 'comments', 'likes', 'follows', 'invites', 'events', 'messages'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Uma cláusula casa o aviso se o tipo estiver na lista e, quando houver `dedupePrefix`, a chave do aviso começar por ele. */
export interface NotificationFilterClause {
  types: NotificationType[];
  dedupePrefix?: string;
}

/** O aviso entra na lista se casar com alguma cláusula. */
export type NotificationFilter = NotificationFilterClause[];

/**
 * Menção num comentário de post é gravada como POST_COMMENT com chave `comment-mention:`; o comentário no seu post,
 * com `post-comment:`. Por isso "Menções" e "Comentários" olham a chave além do tipo.
 */
const FILTERS: Record<Exclude<NotificationCategory, 'all'>, NotificationFilter> = {
  mentions: [{ types: ['FEED_MENTION', 'POST_TAG'] }, { types: ['POST_COMMENT'], dedupePrefix: 'comment-mention:' }],
  comments: [{ types: ['FEED_COMMENT'] }, { types: ['POST_COMMENT'], dedupePrefix: 'post-comment:' }],
  likes: [{ types: ['POST_LIKE', 'FEED_REACTION'] }],
  follows: [{ types: ['FOLLOW_REQUEST', 'FOLLOW_ACCEPTED', 'FOLLOW_NEW'] }],
  invites: [{ types: ['MEETUP_INVITE', 'MEETUP_ACCEPTED', 'MEETUP_CANCELLED', 'FLASH_INVITE'] }],
  events: [{ types: ['EVENT_REMINDER', 'VENUE_CALENDAR', 'VENUE_EVENT', 'FEED_NOTICE'] }],
  messages: [{ types: ['MESSAGE', 'GROUP_REMOVED'] }],
};

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/** Filtro do repositório para a categoria; `undefined` em `all`. */
export function notificationFilter(category: NotificationCategory): NotificationFilter | undefined {
  return category === 'all' ? undefined : FILTERS[category];
}

/** O aviso casa com o filtro? (usado pelo repositório em memória e para conferir o Prisma nos testes). */
export function matchesNotificationFilter(n: { type: NotificationType; dedupeKey: string | null }, filter: NotificationFilter | undefined): boolean {
  if (!filter) return true;
  return filter.some((c) => c.types.includes(n.type) && (c.dedupePrefix === undefined || (n.dedupeKey ?? '').startsWith(c.dedupePrefix)));
}
