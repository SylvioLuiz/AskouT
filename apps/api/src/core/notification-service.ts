import { conflict, unauthorized, validationError } from './errors.ts';
import { isNotificationCategory, notificationFilter, OVERVIEW_FILTER } from './notification-categories.ts';
import type { Clock, ConversationRepository, IdGenerator, LiveActivityTokens, MeetupRepository, Notifier, NotificationRepository, PostRepository, PushLive, PushReplyTokens, PushSender, PushSubscriptionRepository, SchedulingRepository, UserRepository } from './ports.ts';
import type { NotificationMuteSettings, NotificationRecord, NotificationType, PushSubscriptionRecord } from './types.ts';
import { DEFAULT_SOUNDS, isNotificationSound, SOUND_GROUPS, soundGroup } from './notification-sounds.ts';
import type { NotificationSound, NotificationSoundSettings, SoundGroup } from './notification-sounds.ts';
import { DEFAULT_EVENT_REMINDERS, isValidTimeZone, parseReminderList } from './event-reminders.ts';
import type { EventReminderChoiceView } from './event-reminders.ts';

export const NOTIFICATIONS_PAGE = 30;
export const MAX_PUSH_SUBSCRIPTIONS = 10;
/** Quantos avisos dá para marcar como lidos de uma vez pela seleção. */
export const MARK_READ_MAX = 100;
const ENDPOINT_MAX = 1000;
const KEY_MAX = 200;
/** Aparelhos do app guardam o token da Apple como `apns:<token em hexadecimal>` no lugar do endereço do navegador. */
export const NATIVE_ENDPOINT_PREFIX = 'apns:';
/** Aparelhos Android guardam o token do FCM como `fcm:<token>`. */
export const FCM_ENDPOINT_PREFIX = 'fcm:';
/**
 * Live Activity do iPhone (iOS 17.2+), guardada na mesma tabela das inscrições, sem mudar o banco:
 * - `apnsls:<token>`: token "push-to-start" do aparelho (abre a atividade da chegada sem o app aberto);
 * - `apnsla:<token>`: token de uma atividade aberta; o `auth` guarda a `tag` da chegada que ela mostra.
 * Nenhum dos dois recebe os avisos comuns.
 */
export const LIVE_START_PREFIX = 'apnsls:';
export const LIVE_ACTIVITY_PREFIX = 'apnsla:';
/**
 * `apnsld:<pessoa>:<tag>`: a pessoa fechou a Live Activity dessa chegada no iPhone. O iPhone não deixa impedir o
 * fechar, então ela volta sozinha na próxima posição do amigo (passado `LIVE_REOPEN_AFTER_CLOSE_MS`), ou na hora ao
 * voltar ao NOW (ver `reopen`). Só para de voltar quando a chegada termina.
 */
export const LIVE_DISMISSED_PREFIX = 'apnsld:';
const dismissedEndpoint = (userId: string, tag: string): string => `${LIVE_DISMISSED_PREFIX}${userId}:${tag}`;
const isLiveActivityEndpoint = (endpoint: string): boolean => endpoint.startsWith(LIVE_START_PREFIX) || endpoint.startsWith(LIVE_ACTIVITY_PREFIX) || endpoint.startsWith(LIVE_DISMISSED_PREFIX);
/** Sem o token da atividade (o app ainda não registrou), não abre outra igual por este tempo. */
const LIVE_START_RETRY_MS = 10 * 60_000;
/** Fechou a Live Activity: ela volta na próxima posição do amigo que chegar depois disto. */
export const LIVE_REOPEN_AFTER_CLOSE_MS = 10_000;
const NATIVE_TOKEN = /^[0-9a-f]{32,200}$/i;
const FCM_TOKEN = /^[A-Za-z0-9:_-]{50,400}$/;

/** A que grupo de silenciar cada tipo de aviso pertence. Os demais (curtidas, seguidores, Flash...) só calam com "todas". */
export function muteGroup(type: NotificationType): 'chats' | 'events' | null {
  if (type === 'MESSAGE' || type === 'GROUP_REMOVED') return 'chats';
  if (type === 'MEETUP_INVITE' || type === 'MEETUP_ACCEPTED' || type === 'MEETUP_CANCELLED' || type === 'EVENT_REMINDER' || type === 'ALBUM_SUMMARY' || type === 'VENUE_CALENDAR' || type === 'VENUE_EVENT' || type === 'FEED_NOTICE' || type === 'GUEST_LIST' || type === 'EVENT_ADMIN' || type === 'EVENT_UPDATE') return 'events';
  return null;
}

export function isMuted(settings: NotificationMuteSettings, type: NotificationType): boolean {
  if (settings.all) return true;
  const group = muteGroup(type);
  return group === 'chats' ? settings.chats : group === 'events' ? settings.events : false;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  read: boolean;
  createdAt: string;
  /** Quem causou o aviso, para a tela mostrar a foto. Nulo em avisos do sistema, antigos ou de conta que sumiu. */
  actor: NotificationActor | null;
  /** Post (ou evento) da marcação, para a tela mostrar Aceitar/Recusar no próprio aviso. Só em POST_TAG. */
  postId: string | null;
}

export interface NotificationActor {
  userId: string;
  username: string;
  avatarUrl: string | null;
}

export function toNotificationView(n: NotificationRecord, actor: NotificationActor | null = null): NotificationView {
  const postId = n.type === 'POST_TAG' && n.dedupeKey?.startsWith('post-tag:') ? n.dedupeKey.slice('post-tag:'.length) || null : null;
  return { id: n.id, type: n.type, title: n.title, body: n.body, url: n.url, read: n.readAt !== null, createdAt: n.createdAt.toISOString(), actor, postId };
}

interface NotifierDeps {
  notifications: NotificationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  push: PushSender;
  clock: Clock;
  ids: IdGenerator;
  /** Responder pela notificação (app no iPhone/Android). Opcional: sem ele, o push sai sem o campo de resposta. */
  pushReplies?: PushReplyTokens;
  /** Live Activity da chegada no iPhone. Opcional: sem ele, a chegada vai como aviso comum. */
  liveActivityTokens?: LiveActivityTokens;
}

/** Conversa de um aviso de mensagem (`/conversas/<id>`), para o token de resposta. */
export function replyConversationOf(type: NotificationType, url: string): string | undefined {
  if (type !== 'MESSAGE') return undefined;
  return /^\/conversas\/([^/?#]+)$/.exec(url)?.[1];
}

const isNativeEndpoint = (endpoint: string): boolean => endpoint.startsWith(NATIVE_ENDPOINT_PREFIX) || endpoint.startsWith(FCM_ENDPOINT_PREFIX);

/**
 * Som que vai para este aparelho. App antigo (não avisou que tem os sons): só o padrão, porque no Android o canal do
 * som não existiria e o aviso cairia no canal genérico. O navegador recebe o escolhido (só o `silencioso` muda algo).
 */
export function soundForSubscription(sub: Pick<PushSubscriptionRecord, 'endpoint' | 'sounds'>, sound: NotificationSound): NotificationSound {
  if (isNativeEndpoint(sub.endpoint) && sub.sounds !== true) return 'padrao';
  return sound;
}

/** Campo `sound` da mensagem: só vai quando não é o padrão (sem ele, cada sistema toca o som de sempre). */
const soundField = (sub: Pick<PushSubscriptionRecord, 'endpoint' | 'sounds'>, sound: NotificationSound): { sound?: NotificationSound } => {
  const s = soundForSubscription(sub, sound);
  return s === 'padrao' ? {} : { sound: s };
};

/** Som escolhido para o grupo; se não der para ler, o padrão (o aviso sai do mesmo jeito). */
async function chosenSound(notifications: NotificationRepository, userId: string, group: SoundGroup): Promise<NotificationSound> {
  try {
    return (await notifications.getSoundSettings(userId))[group];
  } catch {
    return 'padrao';
  }
}

/** Guarda o aviso e dispara o push em segundo plano. Falhas aqui nunca chegam a quem executou a ação. */
export class StoredNotifier implements Notifier {
  private readonly deps: NotifierDeps;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(deps: NotifierDeps) {
    this.deps = deps;
  }

  async notify(input: { userId: string; type: NotificationType; title: string; body: string; url: string; dedupeKey?: string; actorId?: string }): Promise<void> {
    const { notifications, clock, ids } = this.deps;
    let muted = false;
    try {
      muted = isMuted(await notifications.getMuteSettings(input.userId), input.type);
      const repeated = input.dedupeKey !== undefined && (await notifications.hasUnread(input.userId, input.dedupeKey));
      // O sino guarda um aviso por chave. Mensagem é a exceção do celular: cada mensagem nova chega como push,
      // mesmo com o aviso anterior da conversa ainda não lido (o sino não repete).
      if (repeated && input.type !== 'MESSAGE') return;
      if (!repeated) await notifications.create({
        id: ids.next(),
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        url: input.url,
        dedupeKey: input.dedupeKey ?? null,
        actorId: input.actorId ?? null,
        readAt: null,
        createdAt: clock.now(),
      });
    } catch {
      return;
    }
    // Silenciado: o aviso fica no sino, mas o aparelho não recebe push.
    if (muted) return;
    const job = (async () => this.pushTo({ ...input, sound: await chosenSound(notifications, input.userId, soundGroup(input.type)) }))().catch(() => undefined);
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  /** Tira do sino os avisos com essa chave. Falhas aqui nunca chegam a quem executou a ação. */
  async withdraw(userId: string, dedupeKey: string): Promise<void> {
    try {
      await this.deps.notifications.deleteByKey(userId, dedupeKey);
    } catch {
      // Sem o aviso apagado o convite continua cancelado; a tela trata a marcação que sumiu.
    }
  }

  /**
   * Aviso que se atualiza (chegada do amigo no NOW): só push, nada no sino (seriam dezenas de avisos iguais).
   * Respeita o "silenciar todas". Vai só para o app do celular: o navegador não tem notificação fixa nem barra.
   */
  async live(input: { userId: string; type: NotificationType; title: string; body: string; url: string; tag: string; live: PushLive; who?: { name: string; image?: string }; reopen?: boolean }): Promise<void> {
    const { notifications, pushSubscriptions, push } = this.deps;
    const job = (async () => {
      if (!push.nativeEnabled) return;
      if (isMuted(await notifications.getMuteSettings(input.userId), input.type)) return;
      const all = await pushSubscriptions.listForUser(input.userId);
      // iPhone com Live Activity: a chegada vai para a tela bloqueada (com a barra), e não como aviso comum.
      const route = await this.liveActivity(input, all);
      // Live Activity fechada: no iPhone só vão os avisos que tocam (a chegada) e o de "parou"; as trocas silenciosas não.
      const skipIphone = route === 'activity' || (route === 'dismissed' && input.live.quiet && input.live.state === 'moving');
      const subs = all.filter((s) => isNativeEndpoint(s.endpoint) && !(skipIphone && s.endpoint.startsWith(NATIVE_ENDPOINT_PREFIX)));
      const image = input.who?.image;
      const sound = await chosenSound(notifications, input.userId, 'arrival');
      await Promise.all(
        subs.map(async (sub) => {
          const result = await push.send(sub, { title: input.title, body: input.body, url: input.url, tag: input.tag, live: input.live, ...(image ? { image } : {}), ...soundField(sub, sound) });
          if (result === 'GONE') await pushSubscriptions.remove(sub.endpoint);
        }),
      );
    })().catch(() => undefined);
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  /** Live Activities abertas (ou pedidas) por pessoa e chegada, enquanto o app ainda não registrou a atividade. */
  private readonly activityStarts = new Map<string, number>();

  /**
   * Manda a chegada para a Live Activity do iPhone: atualiza a que está aberta (token registrado pelo app) ou abre
   * uma pelo token "push-to-start". `activity`: o iPhone foi atendido assim (aí não vai o aviso comum); `dismissed`:
   * a pessoa fechou a atividade; `none`: segue o aviso comum.
   */
  private async liveActivity(
    input: { userId: string; title: string; body: string; url: string; tag: string; live: PushLive; who?: { name: string }; reopen?: boolean },
    all: PushSubscriptionRecord[],
  ): Promise<'activity' | 'dismissed' | 'none'> {
    const { push, pushSubscriptions, clock } = this.deps;
    const tokens = this.deps.liveActivityTokens;
    if (!push.liveActivity || !tokens) return 'none';
    const live = input.live;
    const nowMs = clock.now().getTime();
    const key = `${input.userId}|${input.tag}`;
    const dismissed = all.find((s) => s.endpoint === dismissedEndpoint(input.userId, input.tag));
    // Fechou, mas o amigo segue a caminho: o iPhone não deixa impedir o fechar, então volta na próxima posição.
    const reopenAfterClose = dismissed !== undefined && live.state !== 'stopped' && nowMs - dismissed.createdAt.getTime() >= LIVE_REOPEN_AFTER_CLOSE_MS;
    if (input.reopen || reopenAfterClose) {
      // Voltou ao NOW (ou fechou há pouco e o amigo segue a caminho): esquece o "fechou" e as atividades antigas, e abre outra.
      for (const s of all) if (s === dismissed || (s.endpoint.startsWith(LIVE_ACTIVITY_PREFIX) && s.auth === input.tag)) await pushSubscriptions.remove(s.endpoint);
      all = all.filter((s) => s !== dismissed && !(s.endpoint.startsWith(LIVE_ACTIVITY_PREFIX) && s.auth === input.tag));
      this.activityStarts.delete(key);
    } else if (dismissed) {
      if (live.state === 'stopped') await pushSubscriptions.remove(dismissed.endpoint);
      return 'dismissed';
    }
    const state = { title: input.title, body: input.body, progress: live.progress, arrived: live.state === 'arrived' };
    const alert = live.quiet || live.state === 'stopped' ? undefined : { title: input.title, body: input.body };
    // Som da chegada escolhido pela pessoa. Num app antigo, sem o arquivo, o iPhone toca o som padrão.
    const sound = alert ? await chosenSound(this.deps.notifications, input.userId, 'arrival') : 'padrao';
    const send = async (sub: PushSubscriptionRecord, event: 'start' | 'update' | 'end', extra: { attributes?: { name: string; tag: string; url: string; registration: string } } = {}) => {
      const token = sub.endpoint.slice(sub.endpoint.startsWith(LIVE_START_PREFIX) ? LIVE_START_PREFIX.length : LIVE_ACTIVITY_PREFIX.length);
      const result = await push.liveActivity!({
        token,
        event,
        state,
        ...(alert ? { alert } : {}),
        ...(sound !== 'padrao' ? { sound } : {}),
        ...extra,
        staleAtMs: live.untilMs,
        ...(event === 'end' ? { dismissAtMs: Math.min(live.untilMs, nowMs + 60_000) } : {}),
      });
      if (result === 'GONE' || (event === 'end' && sub.endpoint.startsWith(LIVE_ACTIVITY_PREFIX))) await pushSubscriptions.remove(sub.endpoint);
      return result;
    };

    const activities = all.filter((s) => s.endpoint.startsWith(LIVE_ACTIVITY_PREFIX) && s.auth === input.tag);
    if (activities.length > 0) {
      const event = live.state === 'stopped' ? 'end' : 'update';
      await Promise.all(activities.map((sub) => send(sub, event)));
      if (event === 'end') this.activityStarts.delete(key);
      return 'activity';
    }
    const starters = all.filter((s) => s.endpoint.startsWith(LIVE_START_PREFIX));
    if (starters.length === 0) return 'none';
    if (live.state === 'stopped') {
      this.activityStarts.delete(key);
      // Abriu e o app não chegou a registrar: não há como fechar daqui. Ela fica desatualizada no fim do encontro.
      return 'none';
    }
    const startedAt = this.activityStarts.get(key);
    if (startedAt !== undefined && nowMs - startedAt < LIVE_START_RETRY_MS) return 'activity';
    const attributes = { name: input.who?.name ?? '', tag: input.tag, url: input.url, registration: tokens.issue(input.userId, input.tag) };
    const results = await Promise.all(starters.map((sub) => send(sub, 'start', { attributes })));
    if (!results.includes('SENT')) return 'none';
    this.activityStarts.set(key, nowMs);
    return 'activity';
  }

  /** Espera os envios em andamento (usado nos testes e no desligamento). */
  async flush(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  private async pushTo(input: { userId: string; title: string; body: string; url: string; type: NotificationType; dedupeKey?: string; sound: NotificationSound }): Promise<void> {
    const { pushSubscriptions, push } = this.deps;
    if (push.publicKey === null && !push.nativeEnabled) return;
    const subs = (await pushSubscriptions.listForUser(input.userId)).filter((s) => !isLiveActivityEndpoint(s.endpoint));
    const conversationId = replyConversationOf(input.type, input.url);
    const replies = this.deps.pushReplies;
    await Promise.all(
      subs.map(async (sub) => {
        // "Responder" só no app (iPhone/Android), e com um token preso a este aparelho.
        const reply = replies && conversationId && sub.replyable === true && isNativeEndpoint(sub.endpoint) ? replies.issue(input.userId, conversationId, sub.endpoint) : undefined;
        const result = await push.send(sub, { title: input.title, body: input.body, url: input.url, tag: input.dedupeKey ?? input.type, ...(reply ? { reply } : {}), ...soundField(sub, input.sound) });
        if (result === 'GONE') await pushSubscriptions.remove(sub.endpoint);
      }),
    );
  }
}

export interface PushSubscribeInput {
  endpoint: unknown;
  keys: unknown;
  /** O app do aparelho sabe mostrar "Responder" na notificação (só vale para `apns:`/`fcm:`). */
  reply?: unknown;
  /** O app do aparelho tem os sons do AskouT (só vale para `apns:`/`fcm:`). */
  sounds?: unknown;
}

/** O que a lista usa para descobrir quem causou cada aviso (inclusive nos antigos, gravados sem `actorId`). */
interface ActorLookupDeps {
  users: Pick<UserRepository, 'findProfilesByIds' | 'findById'>;
  conversations: Pick<ConversationRepository, 'findById' | 'participantIds' | 'listMessages'>;
  posts: Pick<PostRepository, 'findById' | 'findComment'>;
  meetups: Pick<MeetupRepository, 'find'>;
  scheduling: Pick<SchedulingRepository, 'find'>;
}

const DIRECT_ACTOR_KEYS = new Set(['follow-request', 'follow-new', 'follow-accepted', 'flash-invite', 'flash-accepted', 'flash-on', 'flash-ask-on']);

export class NotificationService {
  private readonly deps: NotifierDeps & ActorLookupDeps;

  constructor(deps: NotifierDeps & ActorLookupDeps) {
    this.deps = deps;
  }

  /**
   * Os avisos mais recentes. `category` (chips da tela: menções, comentários, curtidas...) filtra no banco, para a
   * página trazer os 30 mais recentes daquela categoria e não só os que sobraram entre os 30 mais recentes de todos.
   * `unread`: não lidos do chip escolhido ("Todas" deixa de fora as mensagens de conversa, que ficam só em "Mensagens").
   */
  async list(userId: string, category: unknown = 'all'): Promise<{ items: NotificationView[]; unread: number }> {
    const { notifications } = this.deps;
    const chosen = category === undefined || category === '' ? 'all' : category;
    if (!isNotificationCategory(chosen)) throw validationError('Dados inválidos', { category: 'Categoria inválida' });
    const filter = notificationFilter(chosen);
    const [items, unread] = await Promise.all([notifications.listForUser(userId, NOTIFICATIONS_PAGE, filter), notifications.unreadCount(userId, filter)]);
    const resolved = await Promise.all(items.map((n) => this.actorOf(n).catch(() => null)));
    const actorIds = [...new Set(resolved.filter((id): id is string => typeof id === 'string'))];
    const profiles = actorIds.length > 0 ? await this.deps.users.findProfilesByIds(actorIds) : [];
    const byId = new Map(profiles.map((p) => [p.userId, { userId: p.userId, username: p.username, avatarUrl: p.avatarUrl }]));
    return { items: items.map((n, i) => toNotificationView(n, byId.get(resolved[i] ?? '') ?? null)), unread };
  }

  /**
   * Quem causou o aviso. Mensagem: quem escreveu por último na conversa (o sino guarda um aviso por conversa).
   * Avisos antigos, sem `actorId`: descobre pela chave do aviso (seguidor, curtida, comentário, convite...).
   */
  private async actorOf(n: NotificationRecord): Promise<string | null> {
    const notMe = (id: string | null | undefined): string | null => (id && id !== n.userId ? id : null);
    if (n.type === 'MESSAGE') {
      const conversationId = /^\/conversas\/([^/?#]+)/.exec(n.url)?.[1];
      if (conversationId) {
        const recent = await this.deps.conversations.listMessages(conversationId, 10);
        const last = [...recent].reverse().find((m) => m.kind !== 'SYSTEM' && m.senderId !== n.userId);
        if (last) return last.senderId;
        const conversation = await this.deps.conversations.findById(conversationId);
        if (conversation && conversation.type !== 'GROUP') {
          const ids = (await this.deps.conversations.participantIds(conversationId)) ?? [];
          return notMe(ids.find((id) => id !== n.userId));
        }
      }
      return notMe(n.actorId);
    }
    if (n.actorId) return notMe(n.actorId);
    const parts = (n.dedupeKey ?? '').split(':');
    const [kind, first, second] = parts;
    if (!kind || !first) return null;
    if (DIRECT_ACTOR_KEYS.has(kind)) return notMe(first);
    if ((kind === 'post-like' || kind === 'comment-like') && second) return notMe(second);
    if (kind === 'post-comment' || kind === 'comment-mention') return notMe((await this.deps.posts.findComment(first))?.authorId);
    if (kind === 'post-tag') return notMe((await this.deps.posts.findById(first))?.post.authorId);
    if (kind === 'meetup-invite') return notMe((await this.deps.meetups.find(first))?.organizerId);
    if (kind === 'poll') return notMe((await this.deps.scheduling.find(first))?.organizerId);
    return null;
  }

  /** Quando chegou o aviso não lido mais recente (ISO), ou nulo. Serve para a bolinha do sino saber o que é novo desde a última visita. */
  async latestUnreadAt(userId: string): Promise<string | null> {
    const items = await this.deps.notifications.listForUser(userId, NOTIFICATIONS_PAGE, OVERVIEW_FILTER);
    const unread = items.filter((n) => n.readAt === null);
    return unread.length === 0 ? null : new Date(Math.max(...unread.map((n) => n.createdAt.getTime()))).toISOString();
  }

  unreadCount(userId: string): Promise<number> {
    return this.deps.notifications.unreadCount(userId, OVERVIEW_FILTER);
  }

  muteSettings(userId: string): Promise<NotificationMuteSettings> {
    return this.deps.notifications.getMuteSettings(userId);
  }

  /** Muda só o que vier (`all`, `chats`, `events`, cada um true/false). */
  async setMuteSettings(userId: string, patch: { all?: unknown; chats?: unknown; events?: unknown }): Promise<NotificationMuteSettings> {
    for (const key of ['all', 'chats', 'events'] as const) {
      if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw validationError('Dados inválidos', { [key]: 'Use true ou false' });
    }
    const current = await this.deps.notifications.getMuteSettings(userId);
    const next: NotificationMuteSettings = { all: (patch.all as boolean | undefined) ?? current.all, chats: (patch.chats as boolean | undefined) ?? current.chats, events: (patch.events as boolean | undefined) ?? current.events };
    await this.deps.notifications.setMuteSettings(userId, next, this.deps.clock.now());
    return next;
  }

  soundSettings(userId: string): Promise<NotificationSoundSettings> {
    return this.deps.notifications.getSoundSettings(userId);
  }

  /** Muda só os grupos que vierem (`chats`, `invites`, `arrival`, `other`), cada um com um som de NOTIFICATION_SOUNDS. */
  async setSoundSettings(userId: string, patch: unknown): Promise<NotificationSoundSettings> {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw validationError('Dados inválidos', { sounds: 'Envie o som de cada tipo de aviso' });
    const p = patch as Record<string, unknown>;
    for (const key of Object.keys(p)) {
      if (!(SOUND_GROUPS as readonly string[]).includes(key)) throw validationError('Dados inválidos', { [key]: 'Tipo de aviso desconhecido' });
      if (!isNotificationSound(p[key])) throw validationError('Dados inválidos', { [key]: 'Som desconhecido' });
    }
    const current = await this.deps.notifications.getSoundSettings(userId);
    const next: NotificationSoundSettings = { ...DEFAULT_SOUNDS, ...current, ...(p as Partial<NotificationSoundSettings>) };
    await this.deps.notifications.setSoundSettings(userId, next, this.deps.clock.now());
    return next;
  }

  /** Lembretes de evento da pessoa (o padrão, "É hoje!" e 30 min antes, enquanto ela não escolher). */
  async eventReminderSettings(userId: string): Promise<EventReminderChoiceView> {
    const saved = (await this.deps.notifications.getEventReminderSettings([userId])).get(userId);
    return saved?.reminders ? { reminders: saved.reminders, custom: true } : { reminders: [...DEFAULT_EVENT_REMINDERS], custom: false };
  }

  /**
   * `{reminders, timeZone?}`: `reminders` é a lista escolhida (vazia = nenhum lembrete) ou `null` para voltar ao padrão.
   * `timeZone` é o fuso do aparelho, para o "É hoje!" sair de manhã na hora da pessoa.
   */
  async setEventReminderSettings(userId: string, body: { reminders?: unknown; timeZone?: unknown }): Promise<EventReminderChoiceView> {
    const reminders = body.reminders === null ? null : parseReminderList(body.reminders);
    if (body.reminders !== null && reminders === null) throw validationError('Dados inválidos', { reminders: 'Escolha os lembretes da lista' });
    if (body.timeZone !== undefined && body.timeZone !== null && !isValidTimeZone(body.timeZone)) throw validationError('Fuso horário inválido', { timeZone: 'Fuso horário inválido' });
    const saved = (await this.deps.notifications.getEventReminderSettings([userId])).get(userId);
    const timeZone = typeof body.timeZone === 'string' ? body.timeZone : (saved?.timeZone ?? null);
    await this.deps.notifications.setEventReminderSettings(userId, { reminders, timeZone }, this.deps.clock.now());
    return this.eventReminderSettings(userId);
  }

  /** Marca um aviso, vários (lista de ids, da seleção na tela) ou todos (sem `id`) como lidos. */
  async markRead(userId: string, id?: string | string[]): Promise<{ unread: number }> {
    const { notifications, clock } = this.deps;
    let ids: string[] | undefined;
    if (Array.isArray(id)) {
      if (id.length === 0) return { unread: await notifications.unreadCount(userId, OVERVIEW_FILTER) };
      if (id.length > MARK_READ_MAX || id.some((x) => typeof x !== 'string' || x === '' || x.length > 100)) throw validationError('Dados inválidos', { ids: `Envie de 1 a ${MARK_READ_MAX} avisos` });
      ids = [...new Set(id)];
    } else if (id !== undefined) ids = [id];
    await notifications.markRead(userId, clock.now(), ids);
    return { unread: await notifications.unreadCount(userId, OVERVIEW_FILTER) };
  }

  /**
   * Manda um aviso de teste para os aparelhos da própria pessoa e diz quantos o serviço (Apple, Google, navegador)
   * aceitou. Serve para conferir se o push está chegando no aparelho sem depender de outra pessoa.
   */
  async testPush(userId: string): Promise<{ devices: number; sent: number; failed: number; removed: number; byKind: Record<'ios' | 'android' | 'web', { sent: number; failed: number }> }> {
    const { pushSubscriptions, push, notifications } = this.deps;
    const subs = await pushSubscriptions.listForUser(userId);
    // Toca o som escolhido para "Outros avisos", para a pessoa ouvir no aparelho como vai ficar.
    const sound = await chosenSound(notifications, userId, 'other');
    const byKind = { ios: { sent: 0, failed: 0 }, android: { sent: 0, failed: 0 }, web: { sent: 0, failed: 0 } };
    let removed = 0;
    await Promise.all(
      subs.map(async (sub) => {
        const kind = sub.endpoint.startsWith(FCM_ENDPOINT_PREFIX) ? 'android' : sub.endpoint.startsWith(NATIVE_ENDPOINT_PREFIX) ? 'ios' : 'web';
        const result = await push.send(sub, { title: 'AskouT', body: 'Aviso de teste: se você está lendo isto, as notificações estão funcionando.', url: '/atividades', tag: 'push-test', ...soundField(sub, sound) }).catch(() => 'FAILED' as const);
        if (result === 'SENT') byKind[kind].sent += 1;
        else byKind[kind].failed += 1;
        if (result === 'GONE') {
          removed += 1;
          await pushSubscriptions.remove(sub.endpoint);
        }
      }),
    );
    const sent = byKind.ios.sent + byKind.android.sent + byKind.web.sent;
    return { devices: subs.length, sent, failed: subs.length - sent, removed, byKind };
  }

  /** Chave pública para o navegador se inscrever; `null` quando o servidor não tem chaves de push. `native`: o app do iPhone pode se registrar. */
  pushKey(): { publicKey: string | null; native: boolean } {
    return { publicKey: this.deps.push.publicKey, native: this.deps.push.nativeEnabled === true };
  }

  async subscribe(userId: string, input: PushSubscribeInput): Promise<{ ok: true }> {
    const { pushSubscriptions, push, clock } = this.deps;
    const endpoint = input.endpoint;
    const keys = typeof input.keys === 'object' && input.keys !== null ? (input.keys as Record<string, unknown>) : {};
    let { p256dh, auth } = keys;
    if (typeof endpoint === 'string' && endpoint.startsWith(LIVE_START_PREFIX)) {
      // iPhone: token "push-to-start" da Live Activity da chegada (ver `live`). Não conta no limite de aparelhos.
      if (!push.nativeEnabled || !push.liveActivity || !this.deps.liveActivityTokens) throw conflict('A Live Activity não está configurada neste servidor');
      if (!NATIVE_TOKEN.test(endpoint.slice(LIVE_START_PREFIX.length))) throw validationError('Inscrição inválida', { endpoint: 'Token inválido' });
      await pushSubscriptions.upsert({ userId, endpoint, p256dh: 'apnsls', auth: 'apnsls', createdAt: clock.now(), replyable: false });
      return { ok: true };
    }
    if (typeof endpoint === 'string' && (endpoint.startsWith(NATIVE_ENDPOINT_PREFIX) || endpoint.startsWith(FCM_ENDPOINT_PREFIX))) {
      // Aparelho do app: o "endereço" é `apns:` (iPhone) ou `fcm:` (Android) + token do aparelho, sem chaves de criptografia.
      if (!push.nativeEnabled) throw conflict('O aviso fora do app não está configurado neste servidor');
      const isFcm = endpoint.startsWith(FCM_ENDPOINT_PREFIX);
      const token = endpoint.slice(isFcm ? FCM_ENDPOINT_PREFIX.length : NATIVE_ENDPOINT_PREFIX.length);
      if (!(isFcm ? FCM_TOKEN : NATIVE_TOKEN).test(token)) throw validationError('Inscrição inválida', { endpoint: 'Token do aparelho inválido' });
      p256dh = isFcm ? 'fcm' : 'apns';
      auth = isFcm ? 'fcm' : 'apns';
    } else {
      if (push.publicKey === null) throw conflict('O aviso fora do app não está configurado neste servidor');
      if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX || !/^https:\/\//.test(endpoint)) {
        throw validationError('Inscrição inválida', { endpoint: 'Endereço inválido' });
      }
      const b64url = /^[A-Za-z0-9_-]+$/;
      if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > KEY_MAX || auth.length > KEY_MAX || !b64url.test(p256dh) || !b64url.test(auth)) {
        throw validationError('Inscrição inválida', { keys: 'Chaves inválidas' });
      }
    }
    const existing = (await pushSubscriptions.listForUser(userId)).filter((s) => !isLiveActivityEndpoint(s.endpoint));
    if (existing.length >= MAX_PUSH_SUBSCRIPTIONS && !existing.some((s) => s.endpoint === endpoint)) {
      throw conflict('Você já tem avisos ligados em muitos aparelhos. Desligue em algum para ligar aqui.');
    }
    const replyable = input.reply === true && isNativeEndpoint(endpoint as string);
    const sounds = input.sounds === true && isNativeEndpoint(endpoint as string);
    await pushSubscriptions.upsert({ userId, endpoint: endpoint as string, p256dh: p256dh as string, auth: auth as string, createdAt: clock.now(), replyable, sounds });
    return { ok: true };
  }

  /**
   * Confere o token do "Responder" da notificação e devolve quem responde e em qual conversa. Recusa se o token é
   * inválido ou venceu, se a conta foi suspensa ou não terminou o cadastro, ou se aquele aparelho não está mais
   * inscrito para essa pessoa (desligou os avisos ou saiu da conta): o token só vale enquanto o aparelho recebe os avisos.
   */
  async replier(token: unknown): Promise<{ userId: string; conversationId: string }> {
    const replies = this.deps.pushReplies;
    const claims = replies?.verify(token);
    if (!replies || !claims) throw unauthorized('Não deu para responder por aqui. Abra a conversa no app.');
    const user = await this.deps.users.findById(claims.userId);
    if (!user || user.status === 'SUSPENDED' || user.profilePending) throw unauthorized('Não deu para responder por aqui. Abra a conversa no app.');
    const subs = await this.deps.pushSubscriptions.listForUser(claims.userId);
    if (!subs.some((s) => replies.endpointHash(s.endpoint) === claims.endpointHash)) throw unauthorized('Não deu para responder por aqui. Abra a conversa no app.');
    return { userId: claims.userId, conversationId: claims.conversationId };
  }

  /**
   * O app do iPhone abriu a Live Activity da chegada e recebeu o token dela: `registration` veio dentro da própria
   * atividade (assinado, preso à pessoa e à chegada). Sem login, porque quem chama é o código nativo, às vezes com
   * o app aberto em segundo plano só para isso.
   */
  async registerLiveActivity(registration: unknown, activityToken: unknown): Promise<{ ok: true }> {
    const claims = this.deps.liveActivityTokens?.verify(registration);
    if (!claims) throw unauthorized('Registro inválido');
    if (typeof activityToken !== 'string' || !NATIVE_TOKEN.test(activityToken)) throw validationError('Token inválido', { token: 'Token inválido' });
    const user = await this.deps.users.findById(claims.userId);
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Registro inválido');
    await this.deps.pushSubscriptions.upsert({ userId: claims.userId, endpoint: LIVE_ACTIVITY_PREFIX + activityToken.toLowerCase(), p256dh: 'apnsla', auth: claims.tag, createdAt: this.deps.clock.now(), replyable: false });
    return { ok: true };
  }

  /**
   * A pessoa fechou a Live Activity da chegada no iPhone (o app avisa, sem login, com o `registration` da atividade):
   * para de mandar para ela; outra abre na próxima posição do amigo (ou ao voltar ao NOW).
   */
  async closeLiveActivity(registration: unknown, activityToken: unknown): Promise<{ ok: true }> {
    const claims = this.deps.liveActivityTokens?.verify(registration);
    if (!claims) throw unauthorized('Registro inválido');
    if (typeof activityToken === 'string' && NATIVE_TOKEN.test(activityToken)) await this.deps.pushSubscriptions.remove(LIVE_ACTIVITY_PREFIX + activityToken.toLowerCase(), claims.userId);
    await this.deps.pushSubscriptions.upsert({ userId: claims.userId, endpoint: dismissedEndpoint(claims.userId, claims.tag), p256dh: 'apnsld', auth: claims.tag, createdAt: this.deps.clock.now(), replyable: false });
    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: unknown): Promise<{ ok: true }> {
    if (typeof endpoint !== 'string' || endpoint === '') throw validationError('Inscrição inválida', { endpoint: 'Informe o endereço' });
    await this.deps.pushSubscriptions.remove(endpoint, userId);
    return { ok: true };
  }
}
