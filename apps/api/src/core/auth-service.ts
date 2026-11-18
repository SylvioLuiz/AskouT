import { createHash, randomBytes } from 'node:crypto';
import { DomainError, conflict, forbidden, notFound, rateLimited, unauthorized, validationError } from './errors.ts';
import type { CoreDeps, SocialProviderInfo } from './ports.ts';
import { checkSignupConsent } from './age-service.ts';
import { MfaService } from './mfa-service.ts';
import type { Actor, ExternalProvider, PendingSignup, Profile, PublicProfile, User, UserRole } from './types.ts';
import { toPublicProfile } from './types.ts';
import {
  PASSWORD_MAX,
  asString,
  avatarUrlProblem,
  assertNoProblems,
  displayNameProblem,
  emailProblem,
  normalizeDisplayName,
  normalizeEmail,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
} from './validation.ts';

export const CODE_TTL_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_CODE_SENDS = 5;
export const MAX_CODE_ATTEMPTS = 5;

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  profile: PublicProfile;
  /** Já passou pelo tutorial inicial: o app só o mostra no primeiro login. */
  onboarded: boolean;
  /**
   * Conta criada pelo Google/Apple que ainda não escolheu o nome de usuário nem informou a data de nascimento.
   * Enquanto for true, o app só mostra a etapa "Complete seu cadastro" (em qualquer login, até concluir).
   */
  profilePending: boolean;
}

/** Conta do Google ou da Apple ligada ao perfil (o e-mail fica só para a própria pessoa). */
export interface LinkedAccount {
  provider: ExternalProvider;
  linkedAt: string;
}

export interface LinkedAccounts {
  items: LinkedAccount[];
  /** false = conta criada pelo Google/Apple sem senha: a última conta ligada não pode ser desligada. */
  hasPassword: boolean;
}

/** Etapa "Complete seu cadastro" de quem entrou pelo Google/Apple. */
export interface CompleteProfileInput {
  username: unknown;
  displayName?: unknown;
  birthDate: unknown;
  acceptTerms: unknown;
  marketingEmail?: unknown;
}

export interface AuthResult {
  user: SessionUser;
  token: string;
}

/** Senha (ou Google/Apple) conferida, mas a conta tem verificação em duas etapas: falta o código do app autenticador. */
export interface MfaChallenge {
  mfaRequired: true;
  /** Comprovante curto da 1ª etapa, para mandar junto com o código em /auth/mfa/verify. Não serve como sessão. */
  mfaToken: string;
  expiresInSeconds: number;
}

/** Só para o painel de gestão: recusa antes de pedir o código quem não tem esse papel. */
export interface LoginOptions {
  requireRole?: UserRole;
}

export interface SignupInput {
  email: unknown;
  username: unknown;
  displayName?: unknown;
  password: unknown;
  /** Data de nascimento AAAA-MM-DD. */
  birthDate?: unknown;
  /** Tem que ser `true`: aceite dos Termos de Uso e da Política de Privacidade. */
  acceptTerms?: unknown;
  /** Opcional: aceita receber novidades por e-mail. Só `true` conta como sim. */
  marketingEmail?: unknown;
}

export interface SignupStarted {
  email: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

export interface ConfirmSignupInput {
  email: unknown;
  code: unknown;
}

export interface LoginInput {
  /** E-mail, "usuario" ou "@usuario". */
  identifier: unknown;
  password: unknown;
}

export interface SocialLoginInput {
  provider: unknown;
  idToken: unknown;
  /** Só na primeira vez: o nome de usuário escolhido para a conta nova. */
  username?: unknown;
  displayName?: unknown;
  /** Só na criação da conta: data de nascimento e aceite dos Termos. */
  birthDate?: unknown;
  acceptTerms?: unknown;
  /** Opcional, só na criação da conta: aceita receber novidades por e-mail. */
  marketingEmail?: unknown;
}

/** A conta externa é nova: falta a pessoa escolher o nome de usuário. */
export interface SocialNeedsProfile {
  needsProfile: true;
  suggestedUsername: string;
  displayName: string;
}

export interface PasswordResetStarted {
  expiresInMinutes: number;
  resendAvailableAt: Date;
}

const INVALID_CODE = 'Código inválido ou expirado';

/** Foto vinda do Google, num tamanho bom para o perfil. Só https e endereço curto (como qualquer foto por URL). */
function socialPicture(raw: string | null | undefined): string | null {
  if (!raw || avatarUrlProblem(raw)) return null;
  // As fotos do Google aceitam o tamanho no fim (=s96-c). Pede maior, para não ficar borrada.
  const sized = /googleusercontent\.com\//.test(raw) ? raw.replace(/=s\d+(-c)?$/, '=s400-c') : raw;
  return avatarUrlProblem(sized) ? raw : sized;
}

/**
 * Carimbo curto derivado do hash da senha, gravado no token. Quando a senha muda, o carimbo muda e os tokens antigos
 * (outros aparelhos) deixam de valer, sem precisar de tabela de sessões.
 */
export function passwordStamp(passwordHash: string): string {
  return createHash('sha256').update(`askout-session:${passwordHash}`).digest('base64url').slice(0, 16);
}

function sessionUser(user: User, profile: Profile): SessionUser {
  return { id: user.id, email: user.email, role: user.role, profile: toPublicProfile(profile), onboarded: Boolean(user.onboardedAt), profilePending: user.profilePending === true };
}

/**
 * Cadastro e login no estilo do Instagram:
 *  - cadastro em duas etapas: dados -> código de 6 dígitos por e-mail -> conta criada e logada;
 *  - e-mail ou nome de usuário já em uso é informado já na primeira etapa;
 *  - login por e-mail ou por @usuario; o e-mail nunca aparece no perfil público.
 */
export class AuthService {
  private readonly deps: CoreDeps;
  private dummyHash: Promise<string> | undefined;
  readonly mfa: MfaService;

  constructor(deps: CoreDeps) {
    this.deps = deps;
    this.mfa = new MfaService(deps);
  }

  /** Etapa 1: valida, guarda o cadastro pendente e envia o código. Nenhuma conta é criada ainda. */
  async startSignup(input: SignupInput): Promise<SignupStarted> {
    const { users, pending, hasher, codes, clock } = this.deps;
    const email = normalizeEmail(asString(input.email));
    const username = normalizeUsername(asString(input.username));
    const rawName = asString(input.displayName);
    const displayName = normalizeDisplayName(rawName.length > 0 ? rawName : username);
    const password = asString(input.password);
    const consent = checkSignupConsent({ birthDate: input.birthDate, acceptTerms: input.acceptTerms }, clock.now());

    assertNoProblems({
      email: emailProblem(email),
      username: usernameProblem(username),
      displayName: displayNameProblem(displayName),
      password: passwordProblem(password, email, username),
    });

    if (await users.findByEmail(email)) {
      throw conflict('Este e-mail já está em uso', { email: 'Este e-mail já está em uso' });
    }
    if (await users.findProfileByUsername(username)) {
      throw conflict('Este nome de usuário já está em uso', { username: 'Este nome de usuário já está em uso' });
    }

    const now = clock.now();
    const existing = await pending.find(email);
    const active = existing && existing.expiresAt.getTime() > now.getTime() ? existing : undefined;
    if (active) this.assertCanSend(active, now); // antes do hash, que é caro

    const code = codes.generate();
    const record: PendingSignup = {
      email,
      username,
      displayName,
      passwordHash: await hasher.hash(password),
      birthDate: consent.birthDate,
      termsVersion: consent.termsVersion,
      marketingEmail: input.marketingEmail === true,
      codeHash: codes.hash(email, code),
      expiresAt: addMs(now, CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sendCount: (active?.sendCount ?? 0) + 1,
      lastSentAt: now,
      createdAt: active?.createdAt ?? now,
    };
    await this.persistAndSend(record, code);
    return { email, expiresAt: record.expiresAt, resendAvailableAt: addMs(now, RESEND_COOLDOWN_SECONDS * 1000) };
  }

  /** Pede um novo código para um cadastro pendente. O código anterior deixa de valer. */
  async resendSignupCode(rawEmail: unknown): Promise<SignupStarted> {
    const { pending, codes, clock } = this.deps;
    const email = normalizeEmail(asString(rawEmail));
    const now = clock.now();
    const existing = await pending.find(email);
    if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
      if (existing) await pending.delete(email);
      throw notFound('Cadastro não encontrado ou expirado. Comece novamente.');
    }
    this.assertCanSend(existing, now);

    const code = codes.generate();
    const record: PendingSignup = {
      ...existing,
      codeHash: codes.hash(email, code),
      expiresAt: addMs(now, CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sendCount: existing.sendCount + 1,
      lastSentAt: now,
    };
    await this.persistAndSend(record, code);
    return { email, expiresAt: record.expiresAt, resendAvailableAt: addMs(now, RESEND_COOLDOWN_SECONDS * 1000) };
  }

  /** Etapa 2: confere o código, cria a conta e já devolve a sessão. */
  async confirmSignup(input: ConfirmSignupInput): Promise<AuthResult> {
    const { users, pending, codes, clock } = this.deps;
    const email = normalizeEmail(asString(input.email));
    const code = asString(input.code).trim();
    if (!/^\d{6}$/.test(code)) throw validationError('Código inválido', { code: 'O código tem 6 números' });

    const record = await pending.find(email);
    const now = clock.now();
    if (!record || record.expiresAt.getTime() <= now.getTime()) {
      if (record) await pending.delete(email);
      throw validationError(INVALID_CODE, { code: INVALID_CODE });
    }
    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      await pending.delete(email);
      throw rateLimited('Muitas tentativas incorretas. Comece o cadastro novamente.');
    }

    if (!codes.matches(email, code, record.codeHash)) {
      const attempts = await pending.incrementAttempts(email);
      if (attempts === undefined) throw validationError(INVALID_CODE, { code: INVALID_CODE });
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await pending.delete(email);
        throw rateLimited('Muitas tentativas incorretas. Comece o cadastro novamente.');
      }
      throw validationError('Código incorreto', { code: 'Código incorreto' });
    }

    const user: User = {
      id: this.deps.ids.next(),
      email: record.email,
      passwordHash: record.passwordHash,
      status: 'ACTIVE',
      role: 'USER',
      createdAt: now,
      birthDate: record.birthDate,
      termsAcceptedAt: now,
      termsVersion: record.termsVersion,
    };
    const profile: Profile = {
      userId: user.id,
      username: record.username,
      displayName: record.displayName,
      bio: null,
      avatarUrl: null,
      isPrivate: false,
    };
    try {
      // Se alguém tomou o e-mail ou o username desde a etapa 1, a restrição de unicidade barra aqui.
      await users.create(user, profile);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'CONFLICT') await pending.delete(email);
      throw error;
    }
    await pending.delete(email);
    await this.recordSignupConsents(user.id, record.marketingEmail === true, now);
    await this.welcome(user.email, profile.username);
    return this.session(user, profile);
  }

  /** Plataformas de login configuradas, com o ID público do aplicativo (o navegador precisa dele). */
  socialProviders(): SocialProviderInfo[] {
    return this.deps.verifier.providers();
  }

  /**
   * Entrar com Google ou Apple. A plataforma garante quem é a pessoa; aqui:
   *  1. conta externa já ligada -> entra;
   *  2. e-mail verificado igual ao de uma conta existente -> liga e entra;
   *  3. senão é conta nova: cria na hora, com um nome de usuário sugerido, e entra com `profilePending`.
   *     O app então pede o nome de usuário e a data de nascimento (`completeProfile`) antes de liberar o resto.
   *     (Apps antigos que já mandam `username`, `birthDate` e `acceptTerms` aqui criam a conta completa, como antes.)
   * Conta criada assim não tem senha utilizável; o acesso é sempre pela plataforma.
   */
  async socialLogin(input: SocialLoginInput, options: LoginOptions = {}): Promise<AuthResult | SocialNeedsProfile | MfaChallenge> {
    const { users, identities, verifier, hasher, clock, ids } = this.deps;
    const provider = asString(input.provider).toUpperCase();
    if (provider !== 'GOOGLE' && provider !== 'APPLE') throw validationError('Plataforma inválida', { provider: 'Plataforma inválida' });
    if (!verifier.providers().some((p) => p.provider === provider)) throw validationError('Esse tipo de login não está disponível', { provider: 'Indisponível' });
    const idToken = asString(input.idToken);
    const claims = idToken !== '' ? await verifier.verify(provider, idToken) : undefined;
    if (!claims) throw unauthorized('Não foi possível entrar com essa conta');

    const now = clock.now();
    const picture = socialPicture(claims.picture);
    const linkedId = await identities.find(provider, claims.subject);
    if (linkedId) {
      await this.adoptPicture(linkedId, picture);
      return this.sessionFor(linkedId, options);
    }

    const email = claims.email && claims.emailVerified ? normalizeEmail(claims.email) : '';
    if (email === '' || emailProblem(email)) throw validationError('A conta não trouxe um e-mail verificado', { provider: 'Use uma conta com e-mail verificado' });

    // Só e-mail verificado pela plataforma pode se juntar a uma conta que já existe.
    const existing = await users.findByEmail(email);
    if (existing) {
      await identities.link(provider, claims.subject, existing.id, now);
      await this.adoptPicture(existing.id, picture);
      return this.sessionFor(existing.id, options);
    }

    // Painel de gestão: nunca cria conta nova.
    if (options.requireRole) throw unauthorized('Essa conta não tem acesso à gestão');

    const rawUsername = asString(input.username);
    const displayName0 = normalizeDisplayName(asString(input.displayName) || claims.name || '');
    if (rawUsername.trim() === '') {
      // Conta criada já no login; nome de usuário e data de nascimento ficam para a etapa seguinte, já logado.
      const username = await this.freeUsername(email);
      const displayName = displayName0 === '' || displayNameProblem(displayName0) ? username : displayName0;
      const user: User = { id: ids.next(), email, passwordHash: await hasher.hash(randomBytes(32).toString('hex')), status: 'ACTIVE', role: 'USER', createdAt: now, birthDate: null, termsAcceptedAt: null, termsVersion: null, profilePending: true, passwordless: true };
      const profile: Profile = { userId: user.id, username, displayName, bio: null, avatarUrl: picture, isPrivate: false };
      await users.create(user, profile);
      await identities.link(provider, claims.subject, user.id, now);
      return this.session(user, profile);
    }
    const username = normalizeUsername(rawUsername);
    const displayName = displayName0 === '' ? username : displayName0;
    assertNoProblems({ username: usernameProblem(username), displayName: displayNameProblem(displayName) });
    if (await users.findProfileByUsername(username)) {
      throw conflict('Este nome de usuário já está em uso', { username: 'Este nome de usuário já está em uso' });
    }

    const consent = checkSignupConsent({ birthDate: input.birthDate, acceptTerms: input.acceptTerms }, now);
    const user: User = { id: ids.next(), email, passwordHash: await hasher.hash(randomBytes(32).toString('hex')), status: 'ACTIVE', role: 'USER', createdAt: now, birthDate: consent.birthDate, termsAcceptedAt: now, termsVersion: consent.termsVersion, passwordless: true };
    const profile: Profile = { userId: user.id, username, displayName, bio: null, avatarUrl: picture, isPrivate: false };
    await users.create(user, profile);
    await identities.link(provider, claims.subject, user.id, now);
    await this.recordSignupConsents(user.id, input.marketingEmail === true, now);
    await this.welcome(user.email, profile.username);
    return this.session(user, profile);
  }

  /**
   * "Complete seu cadastro": quem entrou pela primeira vez com Google/Apple escolhe o nome de usuário (pode manter o sugerido),
   * informa a data de nascimento (18+) e aceita os Termos. Só depois disso o app libera o resto.
   */
  async completeProfile(actor: Actor, input: CompleteProfileInput): Promise<SessionUser> {
    const { users, clock } = this.deps;
    const user = await users.findById(actor.userId);
    const profile = user ? await users.findProfileById(user.id) : undefined;
    if (!user || !profile || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    if (!user.profilePending) throw conflict('O cadastro já foi concluído');

    const now = clock.now();
    const username = normalizeUsername(asString(input.username));
    const rawName = normalizeDisplayName(asString(input.displayName));
    const displayName = rawName === '' ? (profile.displayName === profile.username ? username : profile.displayName) : rawName;
    const problems: Record<string, string> = {};
    const up = usernameProblem(username);
    if (up) problems.username = up;
    const dp = displayNameProblem(displayName);
    if (dp) problems.displayName = dp;
    if (!problems.username && username !== profile.username) {
      const taken = await users.findProfileByUsername(username);
      if (taken && taken.userId !== user.id) problems.username = 'Este nome de usuário já está em uso';
    }
    let consent: { birthDate: string; termsVersion: string } | undefined;
    try {
      consent = checkSignupConsent({ birthDate: input.birthDate, acceptTerms: input.acceptTerms }, now);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      Object.assign(problems, (error as DomainError & { details?: Record<string, string> }).details ?? {});
    }
    if (Object.keys(problems).length > 0 || !consent) {
      if (problems.username === 'Este nome de usuário já está em uso' && Object.keys(problems).length === 1) throw conflict(problems.username, problems);
      throw validationError(Object.values(problems)[0] ?? 'Dados inválidos', problems);
    }

    await users.completePendingProfile(user.id, { username, displayName, birthDate: consent.birthDate, termsVersion: consent.termsVersion, termsAcceptedAt: now });
    await this.recordSignupConsents(user.id, input.marketingEmail === true, now);
    await this.welcome(user.email, username);
    return this.me(actor);
  }

  /** Confere, enquanto a pessoa digita, se o nome de usuário pode ser usado por ela (o próprio atual conta como livre). */
  async usernameAvailable(actor: Actor, raw: unknown): Promise<{ username: string; available: boolean; problem?: string }> {
    const username = normalizeUsername(asString(raw));
    const problem = usernameProblem(username);
    if (problem) return { username, available: false, problem };
    const taken = await this.deps.users.findProfileByUsername(username);
    if (taken && taken.userId !== actor.userId) return { username, available: false, problem: 'Este nome de usuário já está em uso' };
    return { username, available: true };
  }

  /** Contas do Google e da Apple ligadas a este perfil. */
  async linkedAccounts(actor: Actor): Promise<LinkedAccounts> {
    const user = await this.deps.users.findById(actor.userId);
    const rows = await this.deps.identities.listForUser(actor.userId);
    const seen = new Set<string>();
    const items: LinkedAccount[] = [];
    for (const r of rows) {
      if (seen.has(r.provider)) continue;
      seen.add(r.provider);
      items.push({ provider: r.provider, linkedAt: r.createdAt.toISOString() });
    }
    return { items, hasPassword: user ? user.passwordless !== true : true };
  }

  /**
   * Liga uma conta do Google/Apple a um perfil que já existe (ex.: criado com e-mail e senha), para entrar por ela depois.
   * O e-mail da plataforma não precisa ser o mesmo; o que vale é a conta externa, que só pode estar em um perfil.
   */
  async linkAccount(actor: Actor, input: { provider: unknown; idToken: unknown }): Promise<LinkedAccounts> {
    const { identities, verifier, clock } = this.deps;
    const provider = asString(input.provider).toUpperCase();
    if (provider !== 'GOOGLE' && provider !== 'APPLE') throw validationError('Plataforma inválida', { provider: 'Plataforma inválida' });
    if (!verifier.providers().some((p) => p.provider === provider)) throw validationError('Esse tipo de login não está disponível', { provider: 'Indisponível' });
    const idToken = asString(input.idToken);
    const claims = idToken !== '' ? await verifier.verify(provider, idToken) : undefined;
    if (!claims) throw unauthorized('Não foi possível confirmar essa conta');
    const label = provider === 'GOOGLE' ? 'Google' : 'Apple';
    const owner = await identities.find(provider, claims.subject);
    if (owner && owner !== actor.userId) throw conflict(`Essa conta ${label} já está ligada a outro perfil do AskouT`);
    if (!owner) {
      const mine = await identities.listForUser(actor.userId);
      if (mine.some((r) => r.provider === provider)) throw conflict(`Já existe uma conta ${label} ligada a este perfil. Desvincule a atual antes de ligar outra.`);
      await identities.link(provider, claims.subject, actor.userId, clock.now());
      await this.adoptPicture(actor.userId, socialPicture(claims.picture));
    }
    return this.linkedAccounts(actor);
  }

  /**
   * Desliga a conta do Google/Apple. Quem criou o perfil pela plataforma e nunca definiu senha não pode desligar a última
   * (ficaria sem como entrar): primeiro cria uma senha pelo código enviado ao e-mail.
   */
  async unlinkAccount(actor: Actor, rawProvider: unknown): Promise<LinkedAccounts> {
    const provider = asString(rawProvider).toUpperCase();
    if (provider !== 'GOOGLE' && provider !== 'APPLE') throw validationError('Plataforma inválida', { provider: 'Plataforma inválida' });
    const current = await this.linkedAccounts(actor);
    if (!current.items.some((i) => i.provider === provider)) return current;
    // Como no Instagram/TikTok: sem senha, a última forma de entrar não pode ser desligada.
    if (!current.hasPassword && current.items.length <= 1) {
      throw conflict('Essa é a única forma de entrar na sua conta. Crie uma senha antes de desvincular.', { provider: 'Crie uma senha antes' });
    }
    await this.deps.identities.unlink(provider, actor.userId);
    return this.linkedAccounts(actor);
  }

  /** Quem ainda não tem foto de perfil fica com a da conta Google (melhor esforço: nunca troca uma foto já escolhida). */
  private async adoptPicture(userId: string, picture: string | null): Promise<void> {
    if (!picture) return;
    try {
      const profile = await this.deps.users.findProfileById(userId);
      if (profile && !profile.avatarUrl) await this.deps.users.updateProfile({ ...profile, avatarUrl: picture });
    } catch {
      // a foto é cortesia: não pode impedir a entrada
    }
  }

  /** Consentimentos opcionais marcados no cadastro. Só o "sim" vira registro: sem registro, vale "não". */
  private async recordSignupConsents(userId: string, marketingEmail: boolean, at: Date): Promise<void> {
    if (!marketingEmail) return;
    await this.deps.consents.add({ id: this.deps.ids.next(), userId, purpose: 'MARKETING_EMAIL', granted: true, source: 'SIGNUP', at });
  }

  /** Boas-vindas por e-mail. Se o envio falhar, a conta já foi criada e o cadastro segue normalmente. */
  private async welcome(to: string, username: string): Promise<void> {
    try {
      await this.deps.mailer.sendWelcome({ to, username });
    } catch {
      // melhor esforço: ninguém deve perder o cadastro por causa de um e-mail de cortesia
    }
  }

  private async sessionFor(userId: string, options: LoginOptions = {}): Promise<AuthResult | MfaChallenge> {
    const user = await this.deps.users.findById(userId);
    const profile = user ? await this.deps.users.findProfileById(user.id) : undefined;
    if (!user || !profile) throw unauthorized();
    if (user.status === 'SUSPENDED') throw forbidden('Conta suspensa');
    if (options.requireRole && user.role !== options.requireRole) throw unauthorized('Essa conta não tem acesso à gestão');
    return this.sessionOrChallenge(user, profile);
  }

  /** Com verificação em duas etapas ligada, a sessão só sai depois do código (em `verifyMfaLogin`). */
  private async sessionOrChallenge(user: User, profile: Profile): Promise<AuthResult | MfaChallenge> {
    if (await this.mfa.isEnabled(user.id)) {
      const { mfaChallenges } = this.deps;
      return { mfaRequired: true, mfaToken: mfaChallenges.issue(user.id), expiresInSeconds: mfaChallenges.ttlSeconds };
    }
    return this.session(user, profile);
  }

  /** Segunda etapa do login: código do app autenticador (ou de recuperação) + o comprovante da primeira etapa. */
  async verifyMfaLogin(input: { mfaToken: unknown; code: unknown }, options: LoginOptions = {}): Promise<AuthResult> {
    const { users, mfaChallenges } = this.deps;
    const userId = mfaChallenges.verify(asString(input.mfaToken));
    if (!userId) throw unauthorized('A verificação expirou. Entre de novo.');
    const user = await users.findById(userId);
    const profile = user ? await users.findProfileById(user.id) : undefined;
    if (!user || !profile) throw unauthorized();
    if (user.status === 'SUSPENDED') throw forbidden('Conta suspensa');
    if (options.requireRole && user.role !== options.requireRole) throw unauthorized();
    await this.mfa.verifyLogin(user.id, input.code);
    return this.session(user, profile);
  }

  /** Sugere um nome de usuário livre a partir do e-mail. */
  private async freeUsername(email: string): Promise<string> {
    const base = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9._]/g, '').replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.').slice(0, 24);
    const root = base.length >= 3 ? base : `${base}user`.slice(0, 24);
    for (let i = 0; i < 20; i += 1) {
      const candidate = i === 0 ? root : `${root}${i + 1}`;
      if (!usernameProblem(candidate) && !(await this.deps.users.findProfileByUsername(candidate))) return candidate;
    }
    for (let i = 0; i < 20; i += 1) {
      const candidate = `user${randomBytes(4).readUInt32BE(0) % 100_000_000}`;
      if (!usernameProblem(candidate) && !(await this.deps.users.findProfileByUsername(candidate))) return candidate;
    }
    return '';
  }

  /**
   * Esqueci a senha: manda um código de 6 números para o e-mail da conta. A resposta é sempre a mesma,
   * exista a conta ou não (e mesmo quando o envio é recusado por limite), para ninguém descobrir quem tem conta aqui.
   */
  async requestPasswordReset(rawIdentifier: unknown): Promise<PasswordResetStarted> {
    const { passwordResets, codes, clock, mailer } = this.deps;
    const identifier = asString(rawIdentifier).trim();
    if (identifier.length === 0 || identifier.length > 254) throw validationError('Informe seu e-mail ou @usuário', { identifier: 'Informe seu e-mail ou @usuário' });
    const now = clock.now();
    const started: PasswordResetStarted = { expiresInMinutes: CODE_TTL_MINUTES, resendAvailableAt: addMs(now, RESEND_COOLDOWN_SECONDS * 1000) };

    const user = await this.findByIdentifier(identifier);
    // O cadastro já avisa "e-mail já em uso", então esconder aqui não protege nada e deixa quem errou o endereço sem saber o que houve.
    if (!user) throw validationError('Não encontramos uma conta com esse e-mail ou @usuário', { identifier: 'Não encontramos uma conta com esse e-mail ou @usuário' });
    if (user.status === 'SUSPENDED') return started;
    const existing = await passwordResets.find(user.id);
    const active = existing && existing.expiresAt.getTime() > now.getTime() ? existing : undefined;
    if (active) {
      const cooling = active.lastSentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 > now.getTime();
      if (cooling || active.sendCount >= MAX_CODE_SENDS) return started;
    }

    const code = codes.generate();
    await passwordResets.save({
      userId: user.id,
      channel: 'EMAIL',
      codeHash: codes.hash(`reset:${user.id}`, code),
      expiresAt: addMs(now, CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sendCount: (active?.sendCount ?? 0) + 1,
      lastSentAt: now,
    });
    try {
      await mailer.sendPasswordResetCode({ to: user.email, code, expiresInMinutes: CODE_TTL_MINUTES });
    } catch {
      // Falhou o envio: descarta o pedido para poder tentar de novo, sem contar o erro a quem pediu.
      await passwordResets.delete(user.id);
    }
    return started;
  }

  /** Confere o código, grava a nova senha e já entra na conta. */
  async confirmPasswordReset(input: { identifier: unknown; code: unknown; password: unknown }): Promise<AuthResult | MfaChallenge> {
    const { users, passwordResets, codes, hasher, clock } = this.deps;
    const identifier = asString(input.identifier).trim();
    const code = asString(input.code).trim();
    const password = asString(input.password);
    if (!/^\d{6}$/.test(code)) throw validationError('Código inválido', { code: 'O código tem 6 números' });

    const user = identifier.length > 0 && identifier.length <= 254 ? await this.findByIdentifier(identifier) : undefined;
    const profile = user ? await users.findProfileById(user.id) : undefined;
    assertNoProblems({ password: passwordProblem(password, user?.email ?? '', profile?.username ?? '') });

    const now = clock.now();
    const record = user ? await passwordResets.find(user.id) : undefined;
    if (!user || !profile || user.status === 'SUSPENDED' || !record || record.expiresAt.getTime() <= now.getTime()) {
      if (user && record) await passwordResets.delete(user.id);
      throw validationError(INVALID_CODE, { code: INVALID_CODE });
    }
    if (record.attempts >= MAX_CODE_ATTEMPTS) {
      await passwordResets.delete(user.id);
      throw rateLimited('Muitas tentativas incorretas. Peça um novo código.');
    }
    if (!codes.matches(`reset:${user.id}`, code, record.codeHash)) {
      const attempts = await passwordResets.incrementAttempts(user.id);
      if (attempts === undefined) throw validationError(INVALID_CODE, { code: INVALID_CODE });
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await passwordResets.delete(user.id);
        throw rateLimited('Muitas tentativas incorretas. Peça um novo código.');
      }
      throw validationError('Código incorreto', { code: 'Código incorreto' });
    }

    const passwordHash = await hasher.hash(password);
    await users.updatePasswordHash(user.id, passwordHash);
    await passwordResets.delete(user.id);
    // Quem só tem acesso ao e-mail troca a senha, mas não passa da verificação em duas etapas.
    return this.sessionOrChallenge({ ...user, passwordHash }, profile);
  }

  /**
   * Troca a senha de quem já está logado, conferindo a atual. Senha atual errada é VALIDATION, não UNAUTHORIZED:
   * a sessão continua válida. Conta criada por Google/Apple não tem senha conhecida, então não passa daqui.
   */
  async changePassword(userId: string, input: { currentPassword: unknown; newPassword: unknown }): Promise<{ token: string }> {
    const { users, passwordResets, hasher } = this.deps;
    const user = await users.findById(userId);
    const profile = user ? await users.findProfileById(user.id) : undefined;
    if (!user || !profile || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');

    const current = asString(input.currentPassword);
    const next = asString(input.newPassword);
    const currentOk = current.length > 0 && current.length <= PASSWORD_MAX && (await hasher.verify(current, user.passwordHash));
    if (!currentOk) throw validationError('Senha atual incorreta', { currentPassword: 'Senha atual incorreta' });

    const problem = passwordProblem(next, user.email, profile.username) ?? (next === current ? 'A nova senha precisa ser diferente da atual' : undefined);
    if (problem) throw validationError(problem, { newPassword: problem });

    const passwordHash = await hasher.hash(next);
    await users.updatePasswordHash(user.id, passwordHash);
    await passwordResets.delete(user.id);
    // Os outros aparelhos saem; este recebe um token novo e continua logado.
    return { token: this.issueToken({ ...user, passwordHash }) };
  }

  /**
   * Criar senha (conta que nasceu pelo Google/Apple e nunca teve senha), como no Instagram: logado, define a senha sem pedir
   * uma atual. Depois disso dá para entrar com e-mail/@usuário e senha, e desligar o Google/Apple.
   */
  async createPassword(userId: string, input: { newPassword: unknown }): Promise<{ token: string }> {
    const { users, passwordResets, hasher } = this.deps;
    const user = await users.findById(userId);
    const profile = user ? await users.findProfileById(user.id) : undefined;
    if (!user || !profile || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    if (user.passwordless !== true) throw conflict('Sua conta já tem senha. Use "Trocar senha".');
    const next = asString(input.newPassword);
    const problem = passwordProblem(next, user.email, profile.username);
    if (problem) throw validationError(problem, { newPassword: problem });
    const passwordHash = await hasher.hash(next);
    await users.updatePasswordHash(user.id, passwordHash);
    await passwordResets.delete(user.id);
    return { token: this.issueToken({ ...user, passwordHash }) };
  }

  /** Login por e-mail ou por nome de usuário (com ou sem @). */
  async login(input: LoginInput, options: LoginOptions = {}): Promise<AuthResult | MfaChallenge> {
    const { users, hasher } = this.deps;
    const identifier = asString(input.identifier).trim();
    const password = asString(input.password);
    if (identifier.length === 0 || identifier.length > 254) throw unauthorized();
    if (password.length === 0 || password.length > PASSWORD_MAX) throw unauthorized();

    const user = await this.findByIdentifier(identifier);
    // Sempre calcula um hash, mesmo sem usuário, para não revelar pelo tempo se a conta existe.
    const stored = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await hasher.verify(password, stored);
    if (user && !passwordOk && user.passwordless === true) {
      // Conta criada pelo Google/Apple, sem senha: avisa por onde ela entra (como o Instagram faz com contas do Facebook).
      const linked = await this.deps.identities.listForUser(user.id);
      const provider = linked[0]?.provider;
      if (provider) {
        const label = provider === 'GOOGLE' ? 'o Google' : 'a Apple';
        throw new DomainError('UNAUTHORIZED', `Essa conta entra com ${label}. Toque em "Continuar com ${label}" para entrar.`, { socialProvider: provider });
      }
    }
    if (!user || !passwordOk) throw unauthorized();

    if (user.status === 'SUSPENDED') throw forbidden('Conta suspensa');
    if (options.requireRole && user.role !== options.requireRole) throw unauthorized();

    const profile = await users.findProfileById(user.id);
    if (!profile) throw unauthorized();
    return this.sessionOrChallenge(user, profile);
  }

  /**
   * Valida o token e confere o usuário no banco a cada chamada, para que
   * suspensão e mudança de papel valham imediatamente.
   */
  async authenticate(token: unknown): Promise<Actor & { profilePending?: boolean }> {
    const raw = asString(token);
    const claims = raw ? this.deps.tokens.verify(raw) : undefined;
    if (!claims) throw unauthorized('Sessão inválida');
    const user = await this.deps.users.findById(claims.userId);
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    // Senha trocada (aqui ou em "esqueci a senha") derruba as sessões emitidas antes. Tokens antigos sem carimbo valem até expirar.
    if (claims.pwd !== undefined && claims.pwd !== passwordStamp(user.passwordHash)) throw unauthorized('Sua senha foi alterada. Entre novamente.');
    return user.profilePending ? { userId: user.id, role: user.role, profilePending: true } : { userId: user.id, role: user.role };
  }

  /** Dados da própria sessão (inclui o e-mail, que só o dono vê). */
  async me(actor: Actor): Promise<SessionUser> {
    const user = await this.deps.users.findById(actor.userId);
    const profile = user ? await this.deps.users.findProfileById(user.id) : undefined;
    if (!user || !profile || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    return sessionUser(user, profile);
  }

  /** Tutorial inicial concluído ou pulado: não aparece mais em nenhum aparelho. */
  async completeOnboarding(actor: Actor): Promise<{ onboarded: true }> {
    await this.deps.users.markOnboarded(actor.userId, this.deps.clock.now());
    return { onboarded: true };
  }

  /** Começa com @ -> usuário; tem @ no meio -> e-mail; senão -> usuário. */
  private async findByIdentifier(identifier: string): Promise<User | undefined> {
    const { users } = this.deps;
    if (!identifier.startsWith('@') && identifier.includes('@')) {
      return users.findByEmail(normalizeEmail(identifier));
    }
    const profile = await users.findProfileByUsername(normalizeUsername(identifier));
    return profile ? users.findById(profile.userId) : undefined;
  }

  private assertCanSend(active: PendingSignup, now: Date): void {
    const waitMs = active.lastSentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now.getTime();
    if (waitMs > 0) {
      throw rateLimited('Aguarde um pouco para pedir um novo código.', waitMs / 1000);
    }
    if (active.sendCount >= MAX_CODE_SENDS) {
      throw rateLimited(
        'Muitos códigos enviados para este e-mail. Tente novamente mais tarde.',
        (active.expiresAt.getTime() - now.getTime()) / 1000,
      );
    }
  }

  /** Grava e envia. Se o envio falhar, descarta o pendente para a pessoa poder tentar de novo do zero. */
  private async persistAndSend(record: PendingSignup, code: string): Promise<void> {
    await this.deps.pending.save(record);
    try {
      await this.deps.mailer.sendSignupCode({ to: record.email, code, expiresInMinutes: CODE_TTL_MINUTES });
    } catch (error) {
      await this.deps.pending.delete(record.email);
      throw error;
    }
  }

  /**
   * Renova o token de quem já está logado (o app chama ao abrir). Assim a sessão desliza: só expira depois de um
   * longo período sem abrir o app, como nas redes sociais.
   */
  async refresh(actor: Actor): Promise<{ token: string }> {
    const user = await this.deps.users.findById(actor.userId);
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    return { token: this.issueToken(user) };
  }

  private issueToken(user: User): string {
    return this.deps.tokens.issue({ userId: user.id, role: user.role, pwd: passwordStamp(user.passwordHash) });
  }

  private session(user: User, profile: Profile): AuthResult {
    return {
      user: sessionUser(user, profile),
      token: this.issueToken(user),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash('askout-dummy-password');
    return this.dummyHash;
  }
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
