import { openFlashAlbum } from './album-service.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps, RouteResult } from './ports.ts';
import { distanceMeters, midpoint } from './geo.ts';
import { ArrivalTracker, estimateArrival, formatArrivalDistance } from './arrival.ts';
import type { FlashHiddenRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';
import { decay, directCloseness } from './recommendation-service.ts';

/** Ordem da lista "Livres agora": quem está mais perto ou com quem você mais interage. */
export type AvailableOrder = 'near' | 'interaction';
/** Quanto tempo de conversas, curtidas e comentários conta para "mais interação". */
export const NOW_INTERACTION_DAYS = 90;
/** Arredonda a posição para ~1 km: o bastante para ordenar, sem guardar onde a pessoa está. */
export function roundArea(value: number): number {
  return Math.round(value * 100) / 100;
}

export const FLASH_HOURS: readonly number[] = [1, 2, 3];
/** Duração livre em minutos (de 5 em 5), de 5 min até 3 h. */
export const FLASH_MIN_MINUTES = 5;
export const FLASH_MAX_MINUTES = 180;
export const FLASH_NOTE_MAX = 60;
/** Mensagem de sistema que abre o encontro Flash na conversa; o app mostra nela o botão de sugerir lugar. */
export const FLASH_MATCH_MESSAGE = 'NOW combinado! Vocês dois estão disponíveis agora.';
export const INVITE_TTL_MINUTES = 15;
/**
 * Encontro aceito vale isto a partir do aceite (ou até alguém encerrar), mesmo que o NOW de um dos dois acabe antes:
 * a localização e a chegada continuam até o encontro acabar.
 */
export const MATCH_TTL_MINUTES = 180;
/** Quanto dá para estender o NOW de uma vez. O total que falta nunca passa de FLASH_MAX_MINUTES. */
export const FLASH_EXTEND_MINUTES: readonly number[] = [30, 60];
/** Depois disso a última posição conhecida é tratada como "sem sinal". */
export const POSITION_STALE_SECONDS = 120;
/** "Perguntar se está livre": no máximo um pedido por amigo a cada 3 h, até 20 amigos de uma vez. */
export const ASK_COOLDOWN_HOURS = 3;
export const ASK_MAX_USERS = 20;
/**
 * Aviso "fulano ligou o NOW" para os amigos: sai só se a pessoa não tinha ligado o NOW nas últimas 2 h, para quem
 * liga e desliga várias vezes não encher o celular dos amigos.
 */
export const FRIENDS_ON_COOLDOWN_HOURS = 2;
/** Quantos avisos aos amigos saem ao mesmo tempo. */
const FRIENDS_ON_BATCH = 20;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export interface FlashStatusView {
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  note: string | null;
}

export interface FlashVisibilityView {
  /** Eu não vejo o Flash dela. */
  hideTheirs: boolean;
  /** Ela não vê o meu Flash. */
  hideMine: boolean;
}

/** Quem `userId` não enxerga no Flash: quem ele ocultou e quem o ocultou dele. */
function unseenBy(userId: string, rows: FlashHiddenRecord[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.ownerId === userId && r.hideTheirs) out.push(r.otherId);
    if (r.otherId === userId && r.hideMine) out.push(r.ownerId);
  }
  return out;
}

export type InviteDirection = 'SENT' | 'RECEIVED' | 'MATCHED';

export interface AvailableFriendView {
  profile: PublicProfile;
  note: string | null;
  expiresAt: string;
  /** Convite aberto entre você e essa pessoa, se houver. Nunca traz localização. */
  invite: { id: string; direction: InviteDirection } | null;
  /** Distância e tempo aproximados até a pessoa (das regiões de ~1 km de cada um). Nulo se algum dos dois ligou sem localização. */
  approx: ApproxTrip | null;
  /** Ponto aproximado para o mapa: a região de quando ligou, arredondada numa grade de ~3 km. Nulo sem localização. */
  point: { lat: number; lng: number } | null;
}

/** "~3 km · 15 min de carro": arredondado de propósito; nunca dá para achar a pessoa com isso. */
export interface ApproxTrip {
  /** Quilômetros inteiros; 0 quer dizer "menos de 1 km". */
  km: number;
  /** Minutos, de 5 em 5 (mínimo 5). */
  minutes: number;
  mode: 'walk' | 'car';
}

/** Precisão que quem escolheu "aproximada" mostra no encontro. */
export const APPROX_ACCURACY_M = 3000;
/** Grade da posição aproximada: 1/40 de grau, uns 2,8 km. */
const APPROX_GRID = 40;

/** Essa pessoa escolheu mostrar só a posição aproximada neste encontro? */
function approxFor(invite: FlashInviteRecord, userId: string): boolean {
  return invite.fromUserId === userId ? invite.fromApprox === true : invite.toApprox === true;
}

/** Essa pessoa liberou o outro a acompanhar a chegada dela nas notificações do celular? */
function arrivalFor(invite: FlashInviteRecord, userId: string): boolean {
  return invite.fromUserId === userId ? invite.fromArrival === true : invite.toArrival === true;
}

function withArrival(invite: FlashInviteRecord, userId: string, share: boolean): FlashInviteRecord {
  return invite.fromUserId === userId ? { ...invite, fromArrival: share } : { ...invite, toArrival: share };
}

const arrivalTag = (inviteId: string, userId: string): string => `arrival:${inviteId}:${userId}`;

/** Encaixa numa grade de ~3 km quando a pessoa escolheu "aproximada". A posição exata nem chega a ser guardada. */
function fuzzIfApprox(position: FlashPositionRecord, approx: boolean): FlashPositionRecord {
  if (!approx) return position;
  return { ...position, lat: Math.round(position.lat * APPROX_GRID) / APPROX_GRID, lng: Math.round(position.lng * APPROX_GRID) / APPROX_GRID, accuracyM: Math.max(position.accuracyM ?? 0, APPROX_ACCURACY_M) };
}

/** Até 2 km a pé (5 km/h); acima, de carro na cidade (~25 km/h mais 5 min para sair e estacionar). */
export function approxTrip(meters: number): ApproxTrip {
  const km = meters / 1000;
  const walk = km <= 2;
  const raw = walk ? (km / 5) * 60 : (km / 25) * 60 + 5;
  return { km: km < 1 ? 0 : Math.round(km), minutes: Math.max(5, Math.round(raw / 5) * 5), mode: walk ? 'walk' : 'car' };
}

/** Algo que você já aceitou e bate com o horário de um convite do NOW recebido (para avisar antes de responder). */
export interface InviteConflict {
  /** NOW: encontro do NOW já aceito com outra pessoa. MEETUP: encontro de evento que você confirmou. */
  kind: 'NOW' | 'MEETUP';
  title: string | null;
  /** Com quem (quem organiza o encontro ou a outra pessoa do NOW); nulo se você mesmo organiza. */
  withName: string | null;
  startsAt: string;
  endsAt: string;
}

export interface InviteView {
  id: string;
  direction: InviteDirection;
  other: PublicProfile;
  createdAt: string;
  expiresAt: string;
  /** Só nos convites recebidos: compromissos já aceitos no mesmo horário (lista vazia quando não há). */
  conflicts?: InviteConflict[];
}

/** Sem NOW ligado, o "agora" de um convite vale por estas horas para procurar choque de horário. */
const CONFLICT_WINDOW_FALLBACK_MS = 2 * 3_600_000;

export interface InvitesOverview {
  received: InviteView[];
  sent: InviteView[];
  matches: InviteView[];
}

export interface PositionView {
  lat: number;
  lng: number;
  accuracyM: number | null;
  updatedAt: string;
  stale: boolean;
}

export interface MatchView {
  inviteId: string;
  other: PublicProfile;
  expiresAt: string;
  /** Relógio do servidor, para o app calcular "há quanto tempo" sem depender do relógio do aparelho. */
  now: string;
  me: PositionView | null;
  them: PositionView | null;
  /** Conversa 1:1 dos dois (criada ao aceitar). Continua existindo depois que o Flash acaba. */
  conversationId: string;
  /** Lugar que um dos dois escolheu no mapa; nulo enquanto ninguém escolheu. */
  destination: { name: string; lat: number; lng: number; chosenByMe: boolean; chosenAt: string } | null;
  /** Você escolheu mostrar só a sua posição aproximada. */
  meApprox: boolean;
  /** A outra pessoa só mostra a posição aproximada (~1 km). */
  themApprox: boolean;
  /** Você liberou a outra pessoa a acompanhar a sua chegada nas notificações do celular. */
  meArrival: boolean;
  /** A outra pessoa liberou você a acompanhar a chegada dela. */
  themArrival: boolean;
}

/** Rota de cada um até o lugar escolhido. `line` nulo: sem trajeto (o app desenha uma linha reta). */
export interface RoutesView {
  mode: 'foot' | 'driving';
  me: { distanceM: number; durationS: number; line: [number, number][] | null } | null;
  them: { distanceM: number; durationS: number; line: [number, number][] | null } | null;
}

/** O lugar escolhido (ou sugerido pela busca) precisa ficar a no máximo isto do ponto médio (mais metade da distância entre os dois). */
export const DESTINATION_MAX_FROM_MID_M = 100_000;
export const DESTINATION_NAME_MAX = 120;

function sessionView(s: FlashSessionRecord | undefined): FlashStatusView {
  return s
    ? { active: true, startsAt: s.startsAt.toISOString(), expiresAt: s.expiresAt.toISOString(), note: s.note }
    : { active: false, startsAt: null, expiresAt: null, note: null };
}

function parseNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError('Recado inválido', { note: 'Recado inválido' });
  const note = value.trim();
  if (note === '') return null;
  if (Array.from(note).length > FLASH_NOTE_MAX) {
    throw validationError(`Use no máximo ${FLASH_NOTE_MAX} caracteres`, { note: `Use no máximo ${FLASH_NOTE_MAX} caracteres` });
  }
  if (CONTROL_CHARS_RE.test(note)) throw validationError('Recado inválido', { note: 'Recado inválido' });
  return note;
}

function parseCoordinate(value: unknown, field: 'lat' | 'lng', limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -limit || value > limit) {
    throw validationError('Localização inválida', { [field]: 'Localização inválida' });
  }
  return value;
}

export class FlashService {
  private readonly deps: CoreDeps;
  /** Última atualização da chegada enviada por encontro e pessoa (só na memória). */
  private readonly arrivals = new ArrivalTracker();

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Liga o Flash por 1, 2 ou 3 horas. Só um por vez; para mudar a duração é preciso desligar antes. */
  async turnOn(actorId: string, input: { hours?: unknown; minutes?: unknown; note?: unknown; lat?: unknown; lng?: unknown }): Promise<FlashStatusView> {
    const { flash, clock, ids } = this.deps;
    const problems: Record<string, string> = {};
    let minutes = 0;
    if (input.minutes !== undefined) {
      const m = input.minutes;
      if (typeof m !== 'number' || !Number.isInteger(m) || m % 5 !== 0 || m < FLASH_MIN_MINUTES || m > FLASH_MAX_MINUTES) problems.minutes = 'Escolha de 5 minutos a 3 horas, de 5 em 5 minutos';
      else minutes = m;
    } else {
      const hours = input.hours;
      if (typeof hours !== 'number' || !FLASH_HOURS.includes(hours)) problems.hours = 'Escolha 1, 2 ou 3 horas';
      else minutes = hours * 60;
    }
    let note: string | null = null;
    try {
      note = parseNote(input.note);
    } catch {
      problems.note = `Use no máximo ${FLASH_NOTE_MAX} caracteres, sem caracteres especiais`;
    }
    // Localização opcional: sem ela, a lista fica na ordem de interação.
    let area: { lat: number; lng: number } | null = null;
    if (input.lat !== undefined || input.lng !== undefined) {
      const { lat, lng } = input;
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) problems.location = 'Localização inválida';
      else area = { lat: roundArea(lat), lng: roundArea(lng) };
    }
    if (Object.keys(problems).length > 0) throw validationError('Confira os dados do NOW', problems);

    const now = clock.now();
    const previousStart = await flash.lastSessionStart(actorId);
    const session: FlashSessionRecord = {
      id: ids.next(),
      userId: actorId,
      startsAt: now,
      expiresAt: new Date(now.getTime() + minutes * 60_000),
      endedAt: null,
      note,
      area,
    };
    await flash.createSession(session, now);
    const askers = await this.notifyAskers(actorId, now);
    const recentlyOn = previousStart !== undefined && now.getTime() - previousStart.getTime() < FRIENDS_ON_COOLDOWN_HOURS * HOUR_MS;
    if (!recentlyOn) await this.notifyFriendsOn(actorId, askers);
    return sessionView(session);
  }

  /**
   * Avisa os amigos (os dois se seguem, sem bloqueio) que a pessoa ligou o NOW. Só quem consegue ver o NOW dela
   * recebe: fica de fora quem ela ocultou ("ela não vê o meu NOW") e quem ocultou o NOW dela. Quem perguntou
   * "está livre?" já recebeu o aviso próprio e não recebe outro.
   */
  private async notifyFriendsOn(actorId: string, skip: Set<string>): Promise<void> {
    const { flash, follows, users, notifier } = this.deps;
    const rows = await flash.listHidden(actorId);
    const cannotSee = new Set([...rows.filter((r) => r.ownerId === actorId && r.hideMine).map((r) => r.otherId), ...rows.filter((r) => r.otherId === actorId && r.hideTheirs).map((r) => r.ownerId)]);
    const targets = (await follows.listFriendIds(actorId)).filter((id) => id !== actorId && !skip.has(id) && !cannotSee.has(id));
    if (targets.length === 0) return;
    const who = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Um amigo';
    for (let i = 0; i < targets.length; i += FRIENDS_ON_BATCH) {
      await Promise.all(
        targets.slice(i, i + FRIENDS_ON_BATCH).map((id) =>
          notifier.notify({ userId: id, type: 'FLASH_INVITE', title: `${who} ligou o NOW`, body: 'Tá livre agora. Bora sair?', url: '/now', dedupeKey: `flash-on:${actorId}`, actorId }),
        ),
      );
    }
  }

  /** Avisa quem perguntou "está livre?" nas últimas horas que a pessoa ligou o NOW, e limpa os pedidos. Devolve quem foi avisado. */
  private async notifyAskers(actorId: string, now: Date): Promise<Set<string>> {
    const { flash, follows, users, notifier } = this.deps;
    const askers = await flash.listAskersOf(actorId, new Date(now.getTime() - ASK_COOLDOWN_HOURS * HOUR_MS));
    await flash.clearAsksFor(actorId);
    const notified = new Set<string>();
    if (askers.length === 0) return notified;
    const friends = new Set(await follows.listFriendIds(actorId));
    const unseen = new Set(unseenBy(actorId, await flash.listHidden(actorId)));
    const who = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Seu amigo';
    for (const askerId of askers) {
      if (!friends.has(askerId) || unseen.has(askerId)) continue;
      await notifier.notify({ userId: askerId, type: 'FLASH_INVITE', title: `${who} ligou o NOW`, body: 'Você perguntou se estava livre. Bora?', url: '/now', dedupeKey: `flash-ask-on:${actorId}`, actorId });
      notified.add(askerId);
    }
    return notified;
  }

  /**
   * "Perguntar se está livre": manda para cada amigo escolhido um aviso que abre o NOW dele. Só amigos; quem já está
   * com o NOW ligado, quem não se vê no NOW ou quem já recebeu um pedido seu nas últimas 3 h é pulado.
   */
  async ask(actorId: string, input: { userIds?: unknown }): Promise<{ asked: string[]; skipped: string[] }> {
    const { flash, follows, users, clock, notifier } = this.deps;
    const raw = input.userIds;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > ASK_MAX_USERS || raw.some((id) => typeof id !== 'string')) {
      throw validationError('Escolha os amigos', { userIds: `Escolha de 1 a ${ASK_MAX_USERS} amigos` });
    }
    const targets = [...new Set(raw as string[])].filter((id) => id !== actorId);
    const now = clock.now();
    const friends = new Set(await follows.listFriendIds(actorId));
    const rows = await flash.listHidden(actorId);
    const blocked = new Set([...unseenBy(actorId, rows), ...rows.filter((r) => r.ownerId === actorId && r.hideMine).map((r) => r.otherId), ...rows.filter((r) => r.otherId === actorId && r.hideTheirs).map((r) => r.ownerId)]);
    const active = new Set((await flash.listActiveSessions(targets, now)).map((s) => s.userId));
    const who = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Um amigo';
    const asked: string[] = [];
    const skipped: string[] = [];
    for (const id of targets) {
      if (!friends.has(id) || blocked.has(id) || active.has(id)) {
        skipped.push(id);
        continue;
      }
      const last = await flash.lastAsk(actorId, id);
      if (last && now.getTime() - last.getTime() < ASK_COOLDOWN_HOURS * HOUR_MS) {
        skipped.push(id);
        continue;
      }
      await flash.recordAsk(actorId, id, now);
      await notifier.notify({ userId: id, type: 'FLASH_INVITE', title: `${who} quer saber se você está livre agora`, body: 'Ligue o NOW se estiver a fim de sair', url: '/now', dedupeKey: `flash-ask:${actorId}`, actorId });
      asked.push(id);
    }
    if (asked.length === 0 && targets.some((id) => !friends.has(id))) throw forbidden('Só dá para perguntar a amigos');
    return { asked, skipped };
  }

  /**
   * Estende o NOW ligado em 30 minutos ou 1 hora, sem desligar nem perder convites. O tempo que falta fica limitado a
   * 3 horas a partir de agora.
   */
  async extend(actorId: string, input: { minutes?: unknown }): Promise<FlashStatusView> {
    const { flash, clock } = this.deps;
    const now = clock.now();
    const minutes = input.minutes;
    if (typeof minutes !== 'number' || !FLASH_EXTEND_MINUTES.includes(minutes)) throw validationError('Confira os dados do NOW', { minutes: 'Escolha 30 minutos ou 1 hora' });
    const session = await this.requireActive(actorId, now);
    const cap = now.getTime() + FLASH_MAX_MINUTES * 60_000;
    if (session.expiresAt.getTime() >= cap) throw conflict('Seu NOW já está no máximo de 3 horas');
    const expiresAt = new Date(Math.min(cap, session.expiresAt.getTime() + minutes * 60_000));
    if (!(await flash.extendSession(actorId, now, expiresAt))) throw forbidden('Ligue seu NOW primeiro');
    return sessionView({ ...session, expiresAt });
  }

  /** Adiciona, troca ou tira (texto vazio) o recado do NOW já ligado, sem mexer no tempo nem nos convites. */
  async setNote(actorId: string, input: { note?: unknown }): Promise<FlashStatusView> {
    const { flash, clock } = this.deps;
    const now = clock.now();
    let note: string | null;
    try {
      note = parseNote(input.note ?? '');
    } catch {
      throw validationError('Confira o recado', { note: `Use no máximo ${FLASH_NOTE_MAX} caracteres, sem caracteres especiais` });
    }
    const session = await this.requireActive(actorId, now);
    if (!(await flash.setSessionNote(actorId, now, note))) throw forbidden('Ligue seu NOW primeiro');
    return sessionView({ ...session, note });
  }

  /**
   * Desliga o NOW: cancela os convites ainda sem resposta. Encontros já aceitos continuam (localização e chegada
   * seguem até o encontro acabar ou alguém encerrar). Idempotente.
   */
  async turnOff(actorId: string): Promise<{ ended: boolean }> {
    const { flash, clock } = this.deps;
    const now = clock.now();
    const ended = await flash.endSession(actorId, now);
    for (const invite of await flash.listOpenInvitesFor(actorId, now)) {
      if (invite.status !== 'PENDING') continue;
      const status = invite.fromUserId === actorId ? 'CANCELED' : 'DECLINED';
      await flash.saveInvite({ ...invite, status, endedAt: now, respondedAt: invite.respondedAt ?? (status === 'DECLINED' ? now : null) });
    }
    return { ended };
  }

  async status(actorId: string): Promise<FlashStatusView> {
    return sessionView(await this.deps.flash.findActiveSession(actorId, this.deps.clock.now()));
  }

  /** Amigos com Flash ligado. Para ver a lista você também precisa estar com o Flash ligado. */
  async listAvailable(actorId: string, order?: unknown): Promise<AvailableFriendView[]> {
    return (await this.listAvailableRanked(actorId, order)).items;
  }

  /**
   * "Livres agora" em ordem: `near` (padrão quando você ligou com localização) põe primeiro quem está mais perto;
   * `interaction` põe primeiro com quem você mais conversa, curte e comenta. A distância nunca sai na resposta:
   * só a ordem. Quem não informou a localização vai para o fim da ordem por distância.
   */
  async listAvailableRanked(actorId: string, order?: unknown): Promise<{ items: AvailableFriendView[]; order: AvailableOrder; nearAvailable: boolean }> {
    const { flash, follows, users, clock } = this.deps;
    const now = clock.now();
    const mine = await this.requireActive(actorId, now);
    const myArea = mine.area ?? null;
    const chosen: AvailableOrder = order === 'interaction' || order === 'near' ? order : myArea ? 'near' : 'interaction';
    const effective: AvailableOrder = chosen === 'near' && !myArea ? 'interaction' : chosen;

    const skip = new Set(unseenBy(actorId, await flash.listHidden(actorId)));
    const friendIds = (await follows.listFriendIds(actorId)).filter((id) => !skip.has(id));
    const [sessions, invites] = await Promise.all([flash.listActiveSessions(friendIds, now), flash.listOpenInvitesFor(actorId, now)]);
    const profiles = new Map((await users.findProfilesByIds(sessions.map((s) => s.userId))).map((p) => [p.userId, p] as const));

    const items: AvailableFriendView[] = [];
    for (const s of sessions) {
      const profile = profiles.get(s.userId);
      if (!profile) continue;
      const invite = invites.find((i) => i.fromUserId === s.userId || i.toUserId === s.userId);
      items.push({
        profile: toPublicProfile(profile),
        note: s.note,
        expiresAt: s.expiresAt.toISOString(),
        invite: invite ? { id: invite.id, direction: this.directionOf(invite, actorId) } : null,
        approx: myArea && s.area ? approxTrip(distanceMeters(myArea, s.area)) : null,
        point: s.area ? { lat: Math.round(s.area.lat * APPROX_GRID) / APPROX_GRID, lng: Math.round(s.area.lng * APPROX_GRID) / APPROX_GRID } : null,
      });
    }
    const areas = new Map(sessions.map((s) => [s.userId, s.area ?? null] as const));
    const interaction = await this.interactionScores(actorId, items.map((i) => i.profile.userId), now);
    const distance = (id: string): number => {
      const a = areas.get(id);
      return myArea && a ? distanceMeters(myArea, a) : Number.POSITIVE_INFINITY;
    };
    const score = (id: string) => interaction.get(id) ?? 0;
    const byName = (a: AvailableFriendView, b: AvailableFriendView) => a.profile.username.localeCompare(b.profile.username, 'pt-BR');
    items.sort((a, b) =>
      effective === 'near'
        ? distance(a.profile.userId) - distance(b.profile.userId) || score(b.profile.userId) - score(a.profile.userId) || byName(a, b)
        : score(b.profile.userId) - score(a.profile.userId) || distance(a.profile.userId) - distance(b.profile.userId) || byName(a, b),
    );
    // Infinity - Infinity dá NaN: quem está sem localização dos dois lados empata e cai no critério seguinte.
    return { items, order: effective, nearAvailable: myArea !== null };
  }

  /** Quanto você interage com cada pessoa: conversas 1 a 1 e curtidas/comentários nos posts um do outro, valendo mais o recente. */
  private async interactionScores(actorId: string, friendIds: string[], now: Date): Promise<Map<string, number>> {
    const { conversations, posts } = this.deps;
    const out = new Map<string, number>();
    if (friendIds.length === 0) return out;
    const wanted = new Set(friendIds);
    const add = (id: string | undefined, w: number) => {
      if (id && wanted.has(id)) out.set(id, (out.get(id) ?? 0) + w);
    };
    const since = new Date(now.getTime() - NOW_INTERACTION_DAYS * 86_400_000);
    for (const [id, w] of directCloseness(await conversations.directActivity(actorId, since, 2000), now)) add(id, w);
    const authorOf = new Map<string, string | undefined>();
    const author = async (postId: string) => {
      if (!authorOf.has(postId)) authorOf.set(postId, (await posts.findById(postId))?.post.authorId);
      return authorOf.get(postId);
    };
    for (const row of await posts.listEngagement(actorId, since, 500)) add(await author(row.postId), (row.kind === 'COMMENT' ? 2 : 1) * decay(row.at, now));
    for (const friendId of friendIds) {
      for (const row of await posts.listEngagement(friendId, since, 200)) {
        if ((await author(row.postId)) === actorId) add(friendId, (row.kind === 'COMMENT' ? 2 : 1) * decay(row.at, now));
      }
    }
    return out;
  }

  /**
   * Quem está com o Flash ligado e eu posso ver, para o raio no avatar: eu mesmo e amigos, menos os que eu ocultei
   * ou que me ocultaram. Não depende do meu Flash estar ligado.
   */
  async activeIds(actorId: string): Promise<string[]> {
    const { flash, follows, clock } = this.deps;
    const now = clock.now();
    const skip = new Set(unseenBy(actorId, await flash.listHidden(actorId)));
    const friendIds = (await follows.listFriendIds(actorId)).filter((id) => !skip.has(id));
    const sessions = await flash.listActiveSessions([actorId, ...friendIds], now);
    return [...new Set(sessions.map((s) => s.userId))];
  }

  /** Como o Flash está oculto entre mim e essa pessoa (só o que eu mesmo escolhi). */
  async visibility(actorId: string, otherId: string): Promise<FlashVisibilityView> {
    const row = (await this.deps.flash.listHidden(actorId)).find((r) => r.ownerId === actorId && r.otherId === otherId);
    return { hideTheirs: row?.hideTheirs ?? false, hideMine: row?.hideMine ?? false };
  }

  /**
   * `hideTheirs`: eu deixo de ver o Flash dela. `hideMine`: ela deixa de me ver disponível.
   * Só o que vier no pedido muda. Convites abertos entre os dois são cancelados ao ocultar.
   */
  async setVisibility(actorId: string, otherId: string, input: { hideTheirs?: unknown; hideMine?: unknown }): Promise<FlashVisibilityView> {
    const { flash, users, clock } = this.deps;
    if (actorId === otherId) throw validationError('Você não pode ocultar o NOW de si mesmo');
    for (const key of ['hideTheirs', 'hideMine'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') throw validationError('Confira os dados', { [key]: 'Use verdadeiro ou falso' });
    }
    const [other] = await users.findProfilesByIds([otherId]);
    if (!other) throw notFound('Pessoa não encontrada');
    const current = await this.visibility(actorId, otherId);
    const next: FlashVisibilityView = {
      hideTheirs: typeof input.hideTheirs === 'boolean' ? input.hideTheirs : current.hideTheirs,
      hideMine: typeof input.hideMine === 'boolean' ? input.hideMine : current.hideMine,
    };
    await flash.setHidden({ ownerId: actorId, otherId, ...next });
    if ((next.hideTheirs && !current.hideTheirs) || (next.hideMine && !current.hideMine)) await flash.closeOpenInvitesBetween(actorId, otherId, clock.now());
    return next;
  }

  /** Convida um amigo que está com o Flash ligado. O convite vale 15 minutos (ou até um dos Flash acabar). */
  async invite(actorId: string, targetId: string, options: { approx?: unknown } = {}): Promise<InviteView> {
    const { flash, follows, users, clock, ids } = this.deps;
    if (actorId === targetId) throw validationError('Você não pode convidar a si mesmo');
    const now = clock.now();
    const mine = await this.requireActive(actorId, now);

    const friends = await follows.listFriendIds(actorId);
    if (!friends.includes(targetId)) throw forbidden('Só amigos podem ser convidados');
    const rows = await flash.listHidden(actorId);
    if (unseenBy(actorId, rows).includes(targetId) || rows.some((r) => r.ownerId === actorId && r.otherId === targetId && r.hideMine) || rows.some((r) => r.ownerId === targetId && r.otherId === actorId && r.hideTheirs)) throw conflict('Essa pessoa não está mais com o NOW ligado');
    const theirs = await flash.findActiveSession(targetId, now);
    if (!theirs) throw conflict('Essa pessoa não está mais com o NOW ligado');
    const [profile] = await users.findProfilesByIds([targetId]);
    if (!profile) throw forbidden('Só amigos podem ser convidados');

    const expiresAt = new Date(Math.min(now.getTime() + INVITE_TTL_MINUTES * MINUTE_MS, mine.expiresAt.getTime(), theirs.expiresAt.getTime()));
    const invite: FlashInviteRecord = {
      id: ids.next(),
      fromUserId: actorId,
      toUserId: targetId,
      status: 'PENDING',
      createdAt: now,
      expiresAt,
      respondedAt: null,
      endedAt: null,
      fromApprox: options.approx === true,
      toApprox: false,
    };
    await flash.createInvite(invite, now);
    const inviter = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Alguém';
    await this.deps.notifier.notify({ userId: targetId, type: 'FLASH_INVITE', title: `${inviter} convidou você para o NOW`, body: 'Vale por poucos minutos', url: '/now', dedupeKey: `flash-invite:${actorId}`, actorId });
    return this.inviteView(invite, actorId, profile);
  }

  /** Quem recebeu aceita ou recusa. Ao aceitar, os dois passam a ver a posição um do outro até o encontro acabar. */
  async respond(actorId: string, inviteId: string, action: unknown, options: { approx?: unknown } = {}): Promise<{ status: 'ACCEPTED' | 'DECLINED'; conversationId: string | null }> {
    if (action !== 'accept' && action !== 'decline') {
      throw validationError('Ação inválida', { action: 'Use accept ou decline' });
    }
    const { flash, blocks, clock } = this.deps;
    const now = clock.now();
    const invite = await flash.getInvite(inviteId);
    if (!invite || invite.toUserId !== actorId || invite.status !== 'PENDING' || invite.expiresAt <= now) {
      throw notFound('Convite não encontrado ou vencido');
    }
    if (await blocks.existsEitherWay(invite.fromUserId, invite.toUserId)) {
      await flash.saveInvite({ ...invite, status: 'CANCELED', endedAt: now });
      throw notFound('Convite não encontrado ou vencido');
    }

    if (action === 'decline') {
      await flash.saveInvite({ ...invite, status: 'DECLINED', respondedAt: now, endedAt: now });
      return { status: 'DECLINED', conversationId: null };
    }

    const [mine, theirs] = await Promise.all([flash.findActiveSession(actorId, now), flash.findActiveSession(invite.fromUserId, now)]);
    if (!mine) throw forbidden('Ligue seu NOW para aceitar');
    if (!theirs) {
      await flash.saveInvite({ ...invite, status: 'CANCELED', endedAt: now });
      throw conflict('Essa pessoa não está mais com o NOW ligado');
    }
    await flash.saveInvite({
      ...invite,
      status: 'ACCEPTED',
      respondedAt: now,
      toApprox: options.approx === true,
      expiresAt: new Date(now.getTime() + MATCH_TTL_MINUTES * MINUTE_MS),
    });
    await openFlashAlbum(this.deps, invite, now);
    const conversation = await this.deps.conversations.getOrCreateDirect(invite.fromUserId, invite.toUserId, this.deps.ids.next(), now);
    await this.deps.conversations.addMessage({ id: this.deps.ids.next(), conversationId: conversation.id, senderId: actorId, kind: 'SYSTEM', body: FLASH_MATCH_MESSAGE, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
    const accepter = (await this.deps.users.findProfilesByIds([actorId]))[0]?.username ?? 'Alguém';
    await this.deps.notifier.notify({ userId: invite.fromUserId, type: 'FLASH_INVITE', title: `${accepter} aceitou seu convite do NOW`, body: 'Vocês podem se encontrar agora', url: `/conversas/${conversation.id}`, dedupeKey: `flash-accepted:${actorId}`, actorId });
    return { status: 'ACCEPTED', conversationId: conversation.id };
  }

  /** Cancela um convite que você enviou, recusa um que recebeu ou encerra um encontro. A posição some. Idempotente. */
  async end(actorId: string, inviteId: string): Promise<{ ended: boolean }> {
    const { flash, clock } = this.deps;
    const now = clock.now();
    const invite = await flash.getInvite(inviteId);
    if (!invite || (invite.fromUserId !== actorId && invite.toUserId !== actorId)) throw notFound('Convite não encontrado');
    if (invite.status !== 'PENDING' && invite.status !== 'ACCEPTED') return { ended: false };

    const status = invite.status === 'ACCEPTED' ? 'ENDED' : invite.fromUserId === actorId ? 'CANCELED' : 'DECLINED';
    await flash.saveInvite({ ...invite, status, endedAt: now, respondedAt: invite.respondedAt ?? (status === 'DECLINED' ? now : null) });
    // Quem acompanhava a chegada de alguém tem o aviso fixo trocado por "encerrado".
    for (const sharer of [invite.fromUserId, invite.toUserId]) {
      if (arrivalFor(invite, sharer)) await this.stopArrival(invite, sharer, 'O encontro foi encerrado').catch(() => undefined);
    }
    return { ended: true };
  }

  /**
   * Libera (ou para) a outra pessoa de acompanhar a sua chegada nas notificações do celular, como o carro chegando
   * no Uber. Só vale neste encontro e só com a posição exata (a aproximada daria um tempo de chegada sem sentido).
   */
  async setArrival(actorId: string, inviteId: string, share: unknown): Promise<{ share: boolean }> {
    if (typeof share !== 'boolean') throw validationError('Escolha inválida', { share: 'Use true ou false' });
    const { flash, clock } = this.deps;
    const now = clock.now();
    const invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    if (share && approxFor(invite, actorId)) throw validationError('Para mostrar sua chegada, use a localização exata', { share: 'Use a localização exata para mostrar sua chegada' });
    if (arrivalFor(invite, actorId) === share) return { share };
    const saved = withArrival(invite, actorId, share);
    await flash.saveInvite(saved);
    if (share) {
      const mine = (await flash.listPositions(inviteId)).find((p) => p.userId === actorId);
      if (mine) await this.pushArrival(saved, mine, now).catch(() => undefined);
    } else {
      await this.stopArrival(saved, actorId, 'Parou de mostrar a chegada').catch(() => undefined);
    }
    return { share };
  }

  /** Manda a atualização da chegada de `position.userId` para a outra pessoa, se for a hora (ver ArrivalTracker). */
  private async pushArrival(invite: FlashInviteRecord, position: FlashPositionRecord, now: Date, retarget = false): Promise<void> {
    const notifier = this.deps.notifier;
    if (!notifier.live) return;
    const sharerId = position.userId;
    const otherId = invite.fromUserId === sharerId ? invite.toUserId : invite.fromUserId;
    const dest = invite.destination;
    let target: { lat: number; lng: number } | undefined = dest ? { lat: dest.lat, lng: dest.lng } : undefined;
    if (!target) {
      const theirs = (await this.deps.flash.listPositions(invite.id)).find((p) => p.userId === otherId);
      if (theirs) target = { lat: theirs.lat, lng: theirs.lng };
    }
    if (!target) return;
    const estimate = estimateArrival(position, target);
    const step = this.arrivals.next(arrivalTag(invite.id, sharerId), estimate, now.getTime());
    if (!step) return;
    const who = (await this.deps.users.findProfilesByIds([sharerId]))[0]?.username ?? 'Seu amigo';
    const title = estimate.arrived ? `${who} chegou` : `${who} está a caminho`;
    const body = estimate.arrived
      ? dest
        ? `Chegou em ${dest.name}`
        : 'Está bem perto de você'
      : `Chega em ~${estimate.minutes} min · ${formatArrivalDistance(estimate.distanceM)} até ${dest ? dest.name : 'você'}`;
    await notifier.live({
      userId: otherId,
      type: 'FLASH_INVITE',
      title,
      body,
      url: `/now/encontro/${invite.id}`,
      tag: arrivalTag(invite.id, sharerId),
      live: { state: estimate.arrived ? 'arrived' : 'moving', progress: step.progress, quiet: (!step.first || retarget) && !estimate.arrived, untilMs: invite.expiresAt.getTime() },
    });
  }

  /** Troca o aviso fixo de quem acompanhava por um aviso final (o Android tira o fixo; o iPhone troca o texto). */
  private async stopArrival(invite: FlashInviteRecord, sharerId: string, body: string): Promise<void> {
    this.arrivals.forget(arrivalTag(invite.id, sharerId));
    const notifier = this.deps.notifier;
    if (!notifier.live) return;
    const otherId = invite.fromUserId === sharerId ? invite.toUserId : invite.fromUserId;
    const who = (await this.deps.users.findProfilesByIds([sharerId]))[0]?.username ?? 'Seu amigo';
    await notifier.live({
      userId: otherId,
      type: 'FLASH_INVITE',
      title: who,
      body,
      url: `/now/encontro/${invite.id}`,
      tag: arrivalTag(invite.id, sharerId),
      live: { state: 'stopped', progress: 0, quiet: true, untilMs: invite.expiresAt.getTime() },
    });
  }

  async listInvites(actorId: string): Promise<InvitesOverview> {
    const { flash, users, clock } = this.deps;
    const open = await flash.listOpenInvitesFor(actorId, clock.now());
    const otherIds = open.map((i) => (i.fromUserId === actorId ? i.toUserId : i.fromUserId));
    const profiles = new Map((await users.findProfilesByIds(otherIds)).map((p) => [p.userId, p] as const));

    const overview: InvitesOverview = { received: [], sent: [], matches: [] };
    for (const invite of open) {
      const profile = profiles.get(invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId);
      if (!profile) continue;
      const view = this.inviteView(invite, actorId, profile);
      if (invite.status === 'ACCEPTED') overview.matches.push(view);
      else if (invite.toUserId === actorId) overview.received.push(view);
      else overview.sent.push(view);
    }
    if (overview.received.length > 0) {
      const busy = await this.acceptedCommitments(actorId, open, profiles);
      for (const view of overview.received) view.conflicts = busy.filter((c) => !(c.kind === 'NOW' && c.withName === view.other.username));
    }
    return overview;
  }

  /**
   * O que você já aceitou e acontece durante o seu "agora" (até o NOW acabar): encontros do NOW em andamento com
   * outras pessoas e encontros de evento confirmados. Serve para avisar, no convite recebido, dia e horário do choque.
   */
  private async acceptedCommitments(actorId: string, open: FlashInviteRecord[], profiles: Map<string, { username: string }>): Promise<InviteConflict[]> {
    const { flash, meetups, users, clock } = this.deps;
    const now = clock.now();
    const session = await flash.findActiveSession(actorId, now);
    const windowEnd = session ? session.expiresAt.getTime() : now.getTime() + CONFLICT_WINDOW_FALLBACK_MS;
    const out: InviteConflict[] = [];
    for (const match of open) {
      if (match.status !== 'ACCEPTED') continue;
      const otherId = match.fromUserId === actorId ? match.toUserId : match.fromUserId;
      out.push({ kind: 'NOW', title: match.destination?.name ?? null, withName: profiles.get(otherId)?.username ?? null, startsAt: (match.respondedAt ?? match.createdAt).toISOString(), endsAt: match.expiresAt.toISOString() });
    }
    const confirmed = (await meetups.listForUser(actorId, 50)).filter((m) => {
      if (m.status !== 'ACTIVE' || m.endsAt.getTime() <= now.getTime() || m.startsAt.getTime() >= windowEnd) return false;
      return m.organizerId === actorId || m.participants.some((p) => p.userId === actorId && p.status === 'CONFIRMED');
    });
    const organizers = new Map((await users.findProfilesByIds([...new Set(confirmed.map((m) => m.organizerId))])).map((p) => [p.userId, p.username] as const));
    for (const m of confirmed) {
      out.push({ kind: 'MEETUP', title: m.title, withName: m.organizerId === actorId ? null : (organizers.get(m.organizerId) ?? null), startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString() });
    }
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  /** Atualiza a sua posição num encontro aceito. Só a última posição é guardada, sem histórico. */
  async shareLocation(actorId: string, inviteId: string, input: { lat?: unknown; lng?: unknown; accuracyM?: unknown }): Promise<{ ok: true }> {
    const lat = parseCoordinate(input.lat, 'lat', 90);
    const lng = parseCoordinate(input.lng, 'lng', 180);
    let accuracyM: number | null = null;
    if (input.accuracyM !== undefined && input.accuracyM !== null) {
      if (typeof input.accuracyM !== 'number' || !Number.isFinite(input.accuracyM) || input.accuracyM < 0 || input.accuracyM > 100_000) {
        throw validationError('Precisão inválida', { accuracyM: 'Precisão inválida' });
      }
      accuracyM = input.accuracyM;
    }
    const now = this.deps.clock.now();
    const invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    const position = fuzzIfApprox({ inviteId, userId: actorId, lat, lng, accuracyM, updatedAt: now }, approxFor(invite, actorId));
    await this.deps.flash.upsertPosition(position);
    // Falha no aviso de chegada nunca atrapalha o envio da posição.
    if (arrivalFor(invite, actorId)) await this.pushArrival(invite, position, now).catch(() => undefined);
    return { ok: true };
  }

  /** Troca, durante o encontro, entre mostrar a posição exata ou só a aproximada. A já guardada é ajustada na hora. */
  async setPrecision(actorId: string, inviteId: string, approx: unknown): Promise<{ approx: boolean }> {
    if (typeof approx !== 'boolean') throw validationError('Escolha inválida', { approx: 'Use true ou false' });
    const { flash, clock } = this.deps;
    const now = clock.now();
    const invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    // Posição aproximada não combina com a chegada ao vivo: ela é desligada junto.
    const changed: FlashInviteRecord = invite.fromUserId === actorId ? { ...invite, fromApprox: approx } : { ...invite, toApprox: approx };
    const stopsArrival = approx && arrivalFor(invite, actorId);
    await flash.saveInvite(stopsArrival ? withArrival(changed, actorId, false) : changed);
    if (stopsArrival) await this.stopArrival(changed, actorId, 'Parou de mostrar a chegada').catch(() => undefined);
    if (approx) {
      const mine = (await flash.listPositions(inviteId)).find((p) => p.userId === actorId);
      if (mine) await flash.upsertPosition(fuzzIfApprox(mine, true));
    }
    return { approx };
  }

  /** O encontro: quem é a outra pessoa e a última posição de cada um (a dela só aparece porque ela aceitou). */
  async getMatch(actorId: string, inviteId: string): Promise<MatchView> {
    const { flash, users, clock } = this.deps;
    const now = clock.now();
    let invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    const otherId = invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId;
    const [profile] = await users.findProfilesByIds([otherId]);
    if (!profile) throw notFound('Encontro não encontrado ou encerrado');
    const conversationId = (await this.deps.conversations.getOrCreateDirect(actorId, otherId, this.deps.ids.next(), now)).id;
    if (!invite.destination) invite = await this.destinationFromChat(invite, conversationId, now);

    const positions = await flash.listPositions(inviteId);
    const view = (p: FlashPositionRecord | undefined): PositionView | null =>
      p
        ? {
            lat: p.lat,
            lng: p.lng,
            accuracyM: p.accuracyM,
            updatedAt: p.updatedAt.toISOString(),
            stale: now.getTime() - p.updatedAt.getTime() > POSITION_STALE_SECONDS * 1000,
          }
        : null;
    return {
      inviteId,
      other: toPublicProfile(profile),
      expiresAt: invite.expiresAt.toISOString(),
      now: now.toISOString(),
      me: view(positions.find((p) => p.userId === actorId)),
      them: view(positions.find((p) => p.userId === otherId)),
      conversationId,
      destination: invite.destination
        ? { name: invite.destination.name, lat: invite.destination.lat, lng: invite.destination.lng, chosenByMe: invite.destination.chosenById === actorId, chosenAt: invite.destination.chosenAt.toISOString() }
        : null,
      meApprox: approxFor(invite, actorId),
      themApprox: approxFor(invite, otherId),
      meArrival: arrivalFor(invite, actorId),
      themArrival: arrivalFor(invite, otherId),
    };
  }

  /** Um dos dois escolhe (ou troca) o lugar do encontro. O outro é avisado e pode escolher outro. */
  async chooseDestination(actorId: string, inviteId: string, input: { name?: unknown; lat?: unknown; lng?: unknown }): Promise<{ ok: true }> {
    const { flash, notifier, users, clock } = this.deps;
    const now = clock.now();
    const invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '' || name.length > DESTINATION_NAME_MAX || CONTROL_CHARS_RE.test(name)) throw validationError('Nome do lugar inválido', { name: `Informe o nome do lugar (até ${DESTINATION_NAME_MAX} letras)` });
    const lat = parseCoordinate(input.lat, 'lat', 90);
    const lng = parseCoordinate(input.lng, 'lng', 180);
    // Só lugares perto dos dois: impede mandar a outra pessoa para qualquer ponto do mapa.
    const positions = await flash.listPositions(inviteId);
    const known = positions.map((p) => ({ lat: p.lat, lng: p.lng }));
    if (known.length === 2) {
      const mid = midpoint(known[0]!, known[1]!);
      if (distanceMeters(mid, { lat, lng }) > DESTINATION_MAX_FROM_MID_M + distanceMeters(known[0]!, known[1]!) / 2) throw validationError('Lugar longe demais', { lat: 'Escolha um lugar perto dos dois' });
    } else if (known.length === 1 && distanceMeters(known[0]!, { lat, lng }) > DESTINATION_MAX_FROM_MID_M) {
      throw validationError('Lugar longe demais', { lat: 'Escolha um lugar perto dos dois' });
    }
    const saved: FlashInviteRecord = { ...invite, destination: { name, lat, lng, chosenById: actorId, chosenAt: now } };
    await flash.saveInvite(saved);
    await this.retargetArrivals(saved, now);
    const otherId = invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId;
    const who = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Alguém';
    await notifier.notify({ userId: otherId, type: 'FLASH_INVITE', title: `${who} escolheu um lugar`, body: name, url: `/now/encontro/${inviteId}`, dedupeKey: `flash-destination:${inviteId}:${name}`, actorId });
    return { ok: true };
  }

  /**
   * Sugestão de local aceita no chat: vira o lugar do encontro NOW ativo entre os dois, se houver.
   * Os dois já concordaram na conversa, então não passa pela trava de distância nem manda outro aviso.
   */
  async destinationAgreedInChat(actorId: string, otherId: string, place: { name: string; lat: number; lng: number }): Promise<void> {
    const now = this.deps.clock.now();
    const invite = await this.activeMatchWith(actorId, otherId, now);
    if (!invite) return;
    const name = place.name.trim().slice(0, DESTINATION_NAME_MAX);
    if (name === '') return;
    const saved: FlashInviteRecord = { ...invite, destination: { name, lat: place.lat, lng: place.lng, chosenById: actorId, chosenAt: now } };
    await this.deps.flash.saveInvite(saved);
    await this.retargetArrivals(saved, now);
  }

  /** O aceite foi cancelado no chat: se o lugar do encontro ainda for aquele, ele sai. */
  async destinationWithdrawnInChat(actorId: string, otherId: string, place: { lat: number; lng: number }): Promise<void> {
    const now = this.deps.clock.now();
    const invite = await this.activeMatchWith(actorId, otherId, now);
    const dest = invite?.destination;
    if (!invite || !dest || Math.abs(dest.lat - place.lat) > 1e-6 || Math.abs(dest.lng - place.lng) > 1e-6) return;
    const saved: FlashInviteRecord = { ...invite, destination: null };
    await this.deps.flash.saveInvite(saved);
    await this.retargetArrivals(saved, now);
  }

  /**
   * Encontro sem lugar, mas com uma sugestão aceita no chat depois do aceite do convite (ex.: aceita antes de o
   * aceite no chat passar a gravar o lugar): o lugar aceito vira o do encontro, e fica gravado.
   */
  private async destinationFromChat(invite: FlashInviteRecord, conversationId: string, now: Date): Promise<FlashInviteRecord> {
    const since = invite.respondedAt ?? invite.createdAt;
    const recent = await this.deps.conversations.listMessages(conversationId, 100, undefined, [], since);
    const agreed = [...recent].reverse().find((m) => m.kind === 'SUGGESTION' && m.response === 'ACCEPTED' && !m.deletedAt && m.suggestion);
    if (!agreed?.suggestion) return invite;
    const name = agreed.suggestion.venueName.trim().slice(0, DESTINATION_NAME_MAX);
    const responder = agreed.senderId === invite.fromUserId ? invite.toUserId : invite.fromUserId;
    const saved: FlashInviteRecord = { ...invite, destination: { name, lat: agreed.suggestion.lat, lng: agreed.suggestion.lng, chosenById: responder, chosenAt: agreed.respondedAt ?? now } };
    await this.deps.flash.saveInvite(saved);
    await this.retargetArrivals(saved, now);
    return saved;
  }

  /** Tirar o lugar do encontro também desfaz o aceite no chat, para o lugar não voltar sozinho. */
  private async withdrawChatAgreement(invite: FlashInviteRecord, actorId: string, now: Date): Promise<void> {
    const dest = invite.destination;
    if (!dest) return;
    const otherId = invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId;
    const conversationId = (await this.deps.conversations.getOrCreateDirect(actorId, otherId, this.deps.ids.next(), now)).id;
    const recent = await this.deps.conversations.listMessages(conversationId, 100, undefined, [], invite.respondedAt ?? invite.createdAt);
    for (const m of recent) {
      if (m.kind === 'SUGGESTION' && m.response === 'ACCEPTED' && m.suggestion && Math.abs(m.suggestion.lat - dest.lat) < 1e-6 && Math.abs(m.suggestion.lng - dest.lng) < 1e-6) {
        await this.deps.conversations.clearSuggestionResponse(m.id, 'ACCEPTED');
      }
    }
  }

  private async activeMatchWith(actorId: string, otherId: string, now: Date): Promise<FlashInviteRecord | undefined> {
    const open = await this.deps.flash.listOpenInvitesFor(actorId, now);
    return open.find((i) => i.status === 'ACCEPTED' && i.expiresAt > now && (i.fromUserId === otherId || i.toUserId === otherId));
  }

  /** Tira o lugar escolhido (qualquer um dos dois). */
  async clearDestination(actorId: string, inviteId: string): Promise<{ ok: true }> {
    const now = this.deps.clock.now();
    const invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    await this.withdrawChatAgreement(invite, actorId, now);
    const saved: FlashInviteRecord = { ...invite, destination: null };
    await this.deps.flash.saveInvite(saved);
    await this.retargetArrivals(saved, now);
    return { ok: true };
  }

  /**
   * O lugar mudou (ou saiu): quem está mostrando a chegada passa a ir para o novo alvo (o lugar, ou a outra pessoa).
   * A barra recomeça do zero e o aviso do amigo troca na hora, em silêncio, sem esperar a próxima posição.
   */
  private async retargetArrivals(invite: FlashInviteRecord, now: Date): Promise<void> {
    const sharers = [invite.fromUserId, invite.toUserId].filter((id) => arrivalFor(invite, id));
    if (sharers.length === 0) return;
    const positions = await this.deps.flash.listPositions(invite.id);
    for (const id of sharers) {
      this.arrivals.forget(arrivalTag(invite.id, id));
      const position = positions.find((p) => p.userId === id);
      if (position) await this.pushArrival(invite, position, now, true).catch(() => undefined);
    }
  }

  /** Rota de cada um (da última posição dele) até o lugar escolhido. Sem lugar escolhido, não há rota. */
  async routes(actorId: string, inviteId: string, mode: unknown): Promise<RoutesView> {
    const m: 'foot' | 'driving' = mode === 'driving' ? 'driving' : 'foot';
    const invite = await this.requireAcceptedMatch(actorId, inviteId, this.deps.clock.now());
    const dest = invite.destination;
    if (!dest) throw conflict('Escolham um lugar primeiro');
    const otherId = invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId;
    const positions = await this.deps.flash.listPositions(inviteId);
    const one = async (userId: string): Promise<RoutesView['me']> => {
      const p = positions.find((x) => x.userId === userId);
      if (!p) return null;
      const from = { lat: p.lat, lng: p.lng };
      const to = { lat: dest.lat, lng: dest.lng };
      const found: RouteResult | undefined = await this.deps.routes?.route(from, to, m).catch(() => undefined);
      if (found) return { distanceM: Math.round(found.distanceM), durationS: Math.round(found.durationS), line: found.line };
      // Sem serviço de rotas: distância em linha reta e tempo estimado (4,8 km/h a pé; 30 km/h de carro).
      const straight = distanceMeters(from, to);
      return { distanceM: Math.round(straight), durationS: Math.round(straight / (m === 'foot' ? 1.33 : 8.33)), line: null };
    };
    return { mode: m, me: await one(actorId), them: await one(otherId) };
  }

  /** Para as sugestões: as duas últimas posições do encontro (uso interno do núcleo, nunca vai para a API). */
  async positionsForMatch(actorId: string, inviteId: string): Promise<{ me: FlashPositionRecord | undefined; them: FlashPositionRecord | undefined; otherId: string }> {
    const invite = await this.requireAcceptedMatch(actorId, inviteId, this.deps.clock.now());
    const otherId = invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId;
    const positions = await this.deps.flash.listPositions(inviteId);
    return { me: positions.find((p) => p.userId === actorId), them: positions.find((p) => p.userId === otherId), otherId };
  }

  /** Faxina periódica (chamada por um agendador na camada HTTP). */
  async purgeExpired(): Promise<{ invites: number; positions: number; removed: number }> {
    return this.deps.flash.purgeExpired(this.deps.clock.now());
  }

  private async requireActive(userId: string, now: Date): Promise<FlashSessionRecord> {
    const session = await this.deps.flash.findActiveSession(userId, now);
    if (!session) throw forbidden('Ligue seu NOW primeiro');
    return session;
  }

  private async requireAcceptedMatch(actorId: string, inviteId: string, now: Date): Promise<FlashInviteRecord> {
    const { flash, blocks } = this.deps;
    const invite = await flash.getInvite(inviteId);
    const mine = invite && (invite.fromUserId === actorId || invite.toUserId === actorId);
    if (!invite || !mine || invite.status !== 'ACCEPTED' || invite.expiresAt <= now) {
      throw notFound('Encontro não encontrado ou encerrado');
    }
    // Defesa extra: se um bloqueio escapou da limpeza, o encontro termina aqui e a posição some.
    if (await blocks.existsEitherWay(invite.fromUserId, invite.toUserId)) {
      await flash.saveInvite({ ...invite, status: 'ENDED', endedAt: now });
      throw notFound('Encontro não encontrado ou encerrado');
    }
    return invite;
  }

  private directionOf(invite: FlashInviteRecord, actorId: string): InviteDirection {
    if (invite.status === 'ACCEPTED') return 'MATCHED';
    return invite.fromUserId === actorId ? 'SENT' : 'RECEIVED';
  }

  private inviteView(invite: FlashInviteRecord, actorId: string, other: { userId: string; username: string; displayName: string; avatarUrl: string | null; isPrivate: boolean }): InviteView {
    return {
      id: invite.id,
      direction: this.directionOf(invite, actorId),
      other: toPublicProfile({ ...other, bio: null }),
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
    };
  }
}
