import { forbidden } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { Actor, PublicProfile, UserStatus } from './types.ts';
import { toPublicProfile } from './types.ts';
import { asString, normalizeUsername, usernameProblem } from './validation.ts';

/**
 * Convite com contagem. Regras (também em GOLIVE.md):
 *  - o convite é registrado uma vez só, logo depois do cadastro concluído (e-mail confirmado ou login social);
 *  - só vale nas primeiras horas da conta (CLAIM_WINDOW_HOURS) e nunca troca depois;
 *  - ignora quem convidou se a conta não existe, está suspensa, é a própria pessoa ou há bloqueio entre as duas;
 *  - convite válido já deixa as duas pessoas amigas (seguimento aceito nos dois sentidos);
 *  - "Você trouxe N amigos" mostra quem entrou (sem suspensos nem bloqueados nos dois sentidos);
 *  - o selo só conta convites CONFIRMADOS: a pessoa voltou ao app pelo menos CONFIRM_AFTER_HOURS depois de criar a conta.
 *    Isso encarece contas criadas em massa: cada uma precisa de e-mail confirmado e de um retorno em outro dia.
 */
export const REFERRAL_BADGE_THRESHOLD = 3;
export const REFERRAL_CLAIM_WINDOW_HOURS = 48;
export const REFERRAL_CONFIRM_AFTER_HOURS = 24;
/** Depois disso o retorno não confirma mais (o convite fica só como "entrou"). */
export const REFERRAL_CONFIRM_UNTIL_DAYS = 30;
export const REFERRAL_LIST_MAX = 200;
export const REFERRAL_TOP_MAX = 50;

const HOUR_MS = 3_600_000;
const hiddenKey = (userId: string) => `referral-badge-hidden:${userId}`;

export interface ReferralPersonView {
  profile: PublicProfile;
  joinedAt: Date;
  /** Já voltou ao app em outro dia: conta para o selo. */
  confirmed: boolean;
}

export interface ReferralOverview {
  /** Quantas pessoas entraram pelo seu convite. */
  brought: number;
  /** Quantas dessas já foram confirmadas (contam para o selo). */
  confirmed: number;
  badgeThreshold: number;
  badgeEarned: boolean;
  badgeHidden: boolean;
  people: ReferralPersonView[];
}

export interface TopInviterView {
  profile: PublicProfile;
  brought: number;
  confirmed: number;
}

const ACTIVE: UserStatus = 'ACTIVE';

/** Confirma o convite da pessoa se ela voltou ao app depois de REFERRAL_CONFIRM_AFTER_HOURS do cadastro. */
export async function confirmReferralReturn(deps: Pick<CoreDeps, 'clock' | 'referrals'>, userId: string, createdAt: Date): Promise<void> {
  const now = deps.clock.now();
  const age = now.getTime() - createdAt.getTime();
  if (age < REFERRAL_CONFIRM_AFTER_HOURS * HOUR_MS || age > REFERRAL_CONFIRM_UNTIL_DAYS * 24 * HOUR_MS) return;
  await deps.referrals.qualify(userId, now);
}

export class ReferralService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Registra quem convidou a pessoa que acabou de se cadastrar. Convite inválido é ignorado em silêncio. */
  async claim(actor: Actor, rawInviter: unknown): Promise<{ counted: boolean }> {
    const { users, blocks, referrals, clock } = this.deps;
    const username = normalizeUsername(asString(rawInviter));
    if (usernameProblem(username)) return { counted: false };
    const me = await users.findById(actor.userId);
    const now = clock.now();
    if (!me || now.getTime() - me.createdAt.getTime() > REFERRAL_CLAIM_WINDOW_HOURS * HOUR_MS) return { counted: false };
    const inviterProfile = await users.findProfileByUsername(username);
    if (!inviterProfile || inviterProfile.userId === actor.userId) return { counted: false };
    const inviter = await users.findById(inviterProfile.userId);
    if (!inviter || inviter.status !== ACTIVE) return { counted: false };
    if (await blocks.existsEitherWay(actor.userId, inviter.id)) return { counted: false };
    const created = await referrals.create({ inviteeId: actor.userId, inviterId: inviter.id, createdAt: now, qualifiedAt: null });
    if (created) await this.befriend(actor.userId, inviter.id);
    return { counted: created };
  }

  /**
   * Quem entrou pelo convite já começa amigo de quem convidou: seguimento aceito nos dois sentidos,
   * mesmo com perfil privado (quem compartilhou o link já topou). Avisa quem convidou.
   */
  private async befriend(inviteeId: string, inviterId: string): Promise<void> {
    const { follows, clock, notifier, users } = this.deps;
    const now = clock.now();
    await follows.save({ followerId: inviteeId, followeeId: inviterId, status: 'ACCEPTED', createdAt: now });
    await follows.save({ followerId: inviterId, followeeId: inviteeId, status: 'ACCEPTED', createdAt: now });
    const invitee = (await users.findProfilesByIds([inviteeId]))[0]?.username;
    await notifier.notify({
      userId: inviterId,
      type: 'FOLLOW_NEW',
      title: `${invitee ?? 'Alguém'} entrou pelo seu convite`,
      body: 'Vocês já são amigos no AskouT',
      url: invitee ? `/u/${encodeURIComponent(invitee)}` : '/atividades',
      dedupeKey: `follow-new:${inviteeId}`,
      actorId: inviteeId,
    });
  }

  /** Chamado quando a pessoa abre o app: se já passou tempo suficiente desde o cadastro, o convite dela passa a contar. */
  confirmReturn(userId: string, createdAt: Date): Promise<void> {
    return confirmReferralReturn(this.deps, userId, createdAt);
  }

  /** Tela do convite: contagem, progresso do selo e quem entrou. */
  async overview(actor: Actor): Promise<ReferralOverview> {
    const people = await this.visiblePeople(actor.userId);
    const confirmed = people.filter((p) => p.confirmed).length;
    return {
      brought: people.length,
      confirmed,
      badgeThreshold: REFERRAL_BADGE_THRESHOLD,
      badgeEarned: confirmed >= REFERRAL_BADGE_THRESHOLD,
      badgeHidden: await this.isBadgeHidden(actor.userId),
      people,
    };
  }

  /** Esconde ou mostra o selo no próprio perfil. */
  async setBadgeHidden(actor: Actor, hidden: unknown): Promise<{ badgeHidden: boolean }> {
    const value = hidden === true;
    await this.deps.settings.set({ key: hiddenKey(actor.userId), value: value ? '1' : '0', updatedAt: this.deps.clock.now(), updatedBy: actor.userId });
    return { badgeHidden: value };
  }

  /** Quantos amigos confirmados mostrar no selo do perfil, ou null se não há selo (não alcançou ou está escondido). */
  async badgeFor(userId: string): Promise<number | null> {
    if (await this.isBadgeHidden(userId)) return null;
    const people = await this.visiblePeople(userId);
    const confirmed = people.filter((p) => p.confirmed).length;
    return confirmed >= REFERRAL_BADGE_THRESHOLD ? confirmed : null;
  }

  /** Painel de gestão: quem mais trouxe gente. */
  async adminTop(actor: Actor, rawLimit?: unknown): Promise<TopInviterView[]> {
    if (actor.role !== 'ADMIN') throw forbidden('Acesso restrito a administradores');
    const n = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 20;
    const limit = Math.min(Math.max(n, 1), REFERRAL_TOP_MAX);
    const rows = await this.deps.referrals.top(limit);
    const profiles = new Map((await this.deps.users.findProfilesByIds(rows.map((r) => r.inviterId))).map((p) => [p.userId, p]));
    return rows.flatMap((r) => {
      const profile = profiles.get(r.inviterId);
      return profile ? [{ profile: toPublicProfile(profile), brought: r.total, confirmed: r.confirmed }] : [];
    });
  }

  private async isBadgeHidden(userId: string): Promise<boolean> {
    return (await this.deps.settings.get(hiddenKey(userId)))?.value === '1';
  }

  /** Convidados que ainda existem, estão ativos e sem bloqueio com quem convidou. */
  private async visiblePeople(inviterId: string): Promise<ReferralPersonView[]> {
    const { referrals, users, blocks } = this.deps;
    const records = await referrals.listByInviter(inviterId, REFERRAL_LIST_MAX);
    if (records.length === 0) return [];
    const related = new Set(await blocks.listRelatedIds(inviterId));
    const allowed = records.filter((r) => !related.has(r.inviteeId));
    // findProfilesByIds já ignora suspensos e mantém a ordem.
    const profiles = new Map((await users.findProfilesByIds(allowed.map((r) => r.inviteeId))).map((p) => [p.userId, p]));
    return allowed.flatMap((r) => {
      const profile = profiles.get(r.inviteeId);
      return profile ? [{ profile: toPublicProfile(profile), joinedAt: r.createdAt, confirmed: r.qualifiedAt !== null }] : [];
    });
  }
}
