import { conflict, forbidden, notFound, validationError } from './errors.ts';
import { AgeService } from './age-service.ts';
import type { CoreDeps } from './ports.ts';
import type { FlashHiddenRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

export const FLASH_HOURS: readonly number[] = [1, 2, 3];
/** Duração livre em minutos (de 5 em 5), de 5 min até 3 h. */
export const FLASH_MIN_MINUTES = 5;
export const FLASH_MAX_MINUTES = 180;
export const FLASH_NOTE_MAX = 60;
/** Mensagem de sistema que abre o encontro Flash na conversa; o app mostra nela o botão de sugerir lugar. */
export const FLASH_MATCH_MESSAGE = 'Flash combinado! Vocês dois estão disponíveis agora.';
export const INVITE_TTL_MINUTES = 15;
/** Depois disso a última posição conhecida é tratada como "sem sinal". */
export const POSITION_STALE_SECONDS = 120;

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
}

export interface InviteView {
  id: string;
  direction: InviteDirection;
  other: PublicProfile;
  createdAt: string;
  expiresAt: string;
}

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
}

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
  private readonly age: AgeService;

  constructor(deps: CoreDeps) {
    this.deps = deps;
    this.age = new AgeService(deps);
  }

  /** Liga o Flash por 1, 2 ou 3 horas. Só um por vez; para mudar a duração é preciso desligar antes. */
  async turnOn(actorId: string, input: { hours?: unknown; minutes?: unknown; note?: unknown }): Promise<FlashStatusView> {
    await this.age.requireAdult(actorId);
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
    if (Object.keys(problems).length > 0) throw validationError('Confira os dados do Flash', problems);

    const now = clock.now();
    const session: FlashSessionRecord = {
      id: ids.next(),
      userId: actorId,
      startsAt: now,
      expiresAt: new Date(now.getTime() + minutes * 60_000),
      endedAt: null,
      note,
    };
    await flash.createSession(session, now);
    return sessionView(session);
  }

  /** Desliga o Flash: cancela convites e encerra encontros, e a posição some. Idempotente. */
  async turnOff(actorId: string): Promise<{ ended: boolean }> {
    const { flash, clock } = this.deps;
    const now = clock.now();
    const ended = await flash.endSession(actorId, now);
    await flash.closeOpenInvitesOf(actorId, now);
    return { ended };
  }

  async status(actorId: string): Promise<FlashStatusView> {
    return sessionView(await this.deps.flash.findActiveSession(actorId, this.deps.clock.now()));
  }

  /** Amigos com Flash ligado. Para ver a lista você também precisa estar com o Flash ligado. */
  async listAvailable(actorId: string): Promise<AvailableFriendView[]> {
    await this.age.requireAdult(actorId);
    const { flash, follows, users, clock } = this.deps;
    const now = clock.now();
    await this.requireActive(actorId, now);

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
      });
    }
    return items.sort((a, b) => a.profile.username.localeCompare(b.profile.username, 'pt-BR'));
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
    if (actorId === otherId) throw validationError('Você não pode ocultar o Flash de si mesmo');
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
  async invite(actorId: string, targetId: string): Promise<InviteView> {
    await this.age.requireAdult(actorId);
    const { flash, follows, users, clock, ids } = this.deps;
    if (actorId === targetId) throw validationError('Você não pode convidar a si mesmo');
    const now = clock.now();
    const mine = await this.requireActive(actorId, now);

    const friends = await follows.listFriendIds(actorId);
    if (!friends.includes(targetId)) throw forbidden('Só amigos podem ser convidados');
    const rows = await flash.listHidden(actorId);
    if (unseenBy(actorId, rows).includes(targetId) || rows.some((r) => r.ownerId === actorId && r.otherId === targetId && r.hideMine) || rows.some((r) => r.ownerId === targetId && r.otherId === actorId && r.hideTheirs)) throw conflict('Essa pessoa não está mais com o Flash ligado');
    const theirs = await flash.findActiveSession(targetId, now);
    if (!theirs) throw conflict('Essa pessoa não está mais com o Flash ligado');
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
    };
    await flash.createInvite(invite, now);
    const inviter = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Alguém';
    await this.deps.notifier.notify({ userId: targetId, type: 'FLASH_INVITE', title: `${inviter} convidou você para o Flash`, body: 'Vale por poucos minutos', url: '/flash', dedupeKey: `flash-invite:${actorId}` });
    return this.inviteView(invite, actorId, profile);
  }

  /** Quem recebeu aceita ou recusa. Ao aceitar, os dois passam a ver a posição um do outro até o encontro acabar. */
  async respond(actorId: string, inviteId: string, action: unknown): Promise<{ status: 'ACCEPTED' | 'DECLINED'; conversationId: string | null }> {
    await this.age.requireAdult(actorId);
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
    if (!mine) throw forbidden('Ligue seu Flash para aceitar');
    if (!theirs) {
      await flash.saveInvite({ ...invite, status: 'CANCELED', endedAt: now });
      throw conflict('Essa pessoa não está mais com o Flash ligado');
    }
    await flash.saveInvite({
      ...invite,
      status: 'ACCEPTED',
      respondedAt: now,
      expiresAt: new Date(Math.min(mine.expiresAt.getTime(), theirs.expiresAt.getTime())),
    });
    const conversation = await this.deps.conversations.getOrCreateDirect(invite.fromUserId, invite.toUserId, this.deps.ids.next(), now);
    await this.deps.conversations.addMessage({ id: this.deps.ids.next(), conversationId: conversation.id, senderId: actorId, kind: 'SYSTEM', body: FLASH_MATCH_MESSAGE, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
    const accepter = (await this.deps.users.findProfilesByIds([actorId]))[0]?.username ?? 'Alguém';
    await this.deps.notifier.notify({ userId: invite.fromUserId, type: 'FLASH_INVITE', title: `${accepter} aceitou seu convite do Flash`, body: 'Vocês podem se encontrar agora', url: `/conversas/${conversation.id}`, dedupeKey: `flash-accepted:${actorId}` });
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
    return { ended: true };
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
    return overview;
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
    await this.requireAcceptedMatch(actorId, inviteId, now);
    await this.deps.flash.upsertPosition({ inviteId, userId: actorId, lat, lng, accuracyM, updatedAt: now });
    return { ok: true };
  }

  /** O encontro: quem é a outra pessoa e a última posição de cada um (a dela só aparece porque ela aceitou). */
  async getMatch(actorId: string, inviteId: string): Promise<MatchView> {
    const { flash, users, clock } = this.deps;
    const now = clock.now();
    const invite = await this.requireAcceptedMatch(actorId, inviteId, now);
    const otherId = invite.fromUserId === actorId ? invite.toUserId : invite.fromUserId;
    const [profile] = await users.findProfilesByIds([otherId]);
    if (!profile) throw notFound('Encontro não encontrado ou encerrado');

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
      conversationId: (await this.deps.conversations.getOrCreateDirect(actorId, otherId, this.deps.ids.next(), now)).id,
    };
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
    if (!session) throw forbidden('Ligue seu Flash primeiro');
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
