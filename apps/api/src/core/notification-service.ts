import { conflict, validationError } from './errors.ts';
import type { Clock, IdGenerator, Notifier, NotificationRepository, PushSender, PushSubscriptionRepository } from './ports.ts';
import type { NotificationRecord, NotificationType } from './types.ts';

export const NOTIFICATIONS_PAGE = 30;
export const MAX_PUSH_SUBSCRIPTIONS = 10;
const ENDPOINT_MAX = 1000;
const KEY_MAX = 200;

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  read: boolean;
  createdAt: string;
}

export function toNotificationView(n: NotificationRecord): NotificationView {
  return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, read: n.readAt !== null, createdAt: n.createdAt.toISOString() };
}

interface NotifierDeps {
  notifications: NotificationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  push: PushSender;
  clock: Clock;
  ids: IdGenerator;
}

/** Guarda o aviso e dispara o push em segundo plano. Falhas aqui nunca chegam a quem executou a ação. */
export class StoredNotifier implements Notifier {
  private readonly deps: NotifierDeps;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(deps: NotifierDeps) {
    this.deps = deps;
  }

  async notify(input: { userId: string; type: NotificationType; title: string; body: string; url: string; dedupeKey?: string }): Promise<void> {
    const { notifications, clock, ids } = this.deps;
    try {
      if (input.dedupeKey && (await notifications.hasUnread(input.userId, input.dedupeKey))) return;
      await notifications.create({
        id: ids.next(),
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        url: input.url,
        dedupeKey: input.dedupeKey ?? null,
        readAt: null,
        createdAt: clock.now(),
      });
    } catch {
      return;
    }
    const job = this.pushTo(input).catch(() => undefined);
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  /** Espera os envios em andamento (usado nos testes e no desligamento). */
  async flush(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  private async pushTo(input: { userId: string; title: string; body: string; url: string; type: NotificationType; dedupeKey?: string }): Promise<void> {
    const { pushSubscriptions, push } = this.deps;
    if (push.publicKey === null) return;
    const subs = await pushSubscriptions.listForUser(input.userId);
    await Promise.all(
      subs.map(async (sub) => {
        const result = await push.send(sub, { title: input.title, body: input.body, url: input.url, tag: input.dedupeKey ?? input.type });
        if (result === 'GONE') await pushSubscriptions.remove(sub.endpoint);
      }),
    );
  }
}

export interface PushSubscribeInput {
  endpoint: unknown;
  keys: unknown;
}

export class NotificationService {
  private readonly deps: NotifierDeps;

  constructor(deps: NotifierDeps) {
    this.deps = deps;
  }

  async list(userId: string): Promise<{ items: NotificationView[]; unread: number }> {
    const { notifications } = this.deps;
    const [items, unread] = await Promise.all([notifications.listForUser(userId, NOTIFICATIONS_PAGE), notifications.unreadCount(userId)]);
    return { items: items.map(toNotificationView), unread };
  }

  /** Quando chegou o aviso não lido mais recente (ISO), ou nulo. Serve para a bolinha do sino saber o que é novo desde a última visita. */
  async latestUnreadAt(userId: string): Promise<string | null> {
    const items = await this.deps.notifications.listForUser(userId, NOTIFICATIONS_PAGE);
    const unread = items.filter((n) => n.readAt === null);
    return unread.length === 0 ? null : new Date(Math.max(...unread.map((n) => n.createdAt.getTime()))).toISOString();
  }

  unreadCount(userId: string): Promise<number> {
    return this.deps.notifications.unreadCount(userId);
  }

  /** Marca um aviso (ou todos, sem `id`) como lido. */
  async markRead(userId: string, id?: string): Promise<{ unread: number }> {
    const { notifications, clock } = this.deps;
    await notifications.markRead(userId, clock.now(), id ? [id] : undefined);
    return { unread: await notifications.unreadCount(userId) };
  }

  /** Chave pública para o navegador se inscrever; `null` quando o servidor não tem chaves de push. */
  pushKey(): { publicKey: string | null } {
    return { publicKey: this.deps.push.publicKey };
  }

  async subscribe(userId: string, input: PushSubscribeInput): Promise<{ ok: true }> {
    const { pushSubscriptions, push, clock } = this.deps;
    if (push.publicKey === null) throw conflict('O aviso fora do app não está configurado neste servidor');
    const endpoint = input.endpoint;
    const keys = typeof input.keys === 'object' && input.keys !== null ? (input.keys as Record<string, unknown>) : {};
    const { p256dh, auth } = keys;
    if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX || !/^https:\/\//.test(endpoint)) {
      throw validationError('Inscrição inválida', { endpoint: 'Endereço inválido' });
    }
    const b64url = /^[A-Za-z0-9_-]+$/;
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > KEY_MAX || auth.length > KEY_MAX || !b64url.test(p256dh) || !b64url.test(auth)) {
      throw validationError('Inscrição inválida', { keys: 'Chaves inválidas' });
    }
    const existing = await pushSubscriptions.listForUser(userId);
    if (existing.length >= MAX_PUSH_SUBSCRIPTIONS && !existing.some((s) => s.endpoint === endpoint)) {
      throw conflict('Você já tem avisos ligados em muitos aparelhos. Desligue em algum para ligar aqui.');
    }
    await pushSubscriptions.upsert({ userId, endpoint, p256dh, auth, createdAt: clock.now() });
    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: unknown): Promise<{ ok: true }> {
    if (typeof endpoint !== 'string' || endpoint === '') throw validationError('Inscrição inválida', { endpoint: 'Informe o endereço' });
    await this.deps.pushSubscriptions.remove(endpoint, userId);
    return { ok: true };
  }
}
