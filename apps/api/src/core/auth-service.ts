import { randomBytes } from 'node:crypto';
import { DomainError, conflict, forbidden, notFound, rateLimited, unauthorized, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { Actor, ExternalProvider, PendingSignup, Profile, PublicProfile, User, UserRole } from './types.ts';
import { toPublicProfile } from './types.ts';
import {
  PASSWORD_MAX,
  asString,
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
}

export interface AuthResult {
  user: SessionUser;
  token: string;
}

export interface SignupInput {
  email: unknown;
  username: unknown;
  displayName?: unknown;
  password: unknown;
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

/**
 * Cadastro e login no estilo do Instagram:
 *  - cadastro em duas etapas: dados -> código de 6 dígitos por e-mail -> conta criada e logada;
 *  - e-mail ou nome de usuário já em uso é informado já na primeira etapa;
 *  - login por e-mail ou por @usuario; o e-mail nunca aparece no perfil público.
 */
export class AuthService {
  private readonly deps: CoreDeps;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Etapa 1: valida, guarda o cadastro pendente e envia o código. Nenhuma conta é criada ainda. */
  async startSignup(input: SignupInput): Promise<SignupStarted> {
    const { users, pending, hasher, codes, clock } = this.deps;
    const email = normalizeEmail(asString(input.email));
    const username = normalizeUsername(asString(input.username));
    const rawName = asString(input.displayName);
    const displayName = normalizeDisplayName(rawName.length > 0 ? rawName : username);
    const password = asString(input.password);

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
    return this.session(user, profile);
  }

  /** Plataformas de login configuradas, com o ID público do aplicativo (o navegador precisa dele). */
  socialProviders(): { provider: ExternalProvider; clientId: string }[] {
    return this.deps.verifier.providers();
  }

  /**
   * Entrar com Google ou Apple. A plataforma garante quem é a pessoa; aqui:
   *  1. conta externa já ligada -> entra;
   *  2. e-mail verificado igual ao de uma conta existente -> liga e entra;
   *  3. senão é conta nova: pede o nome de usuário (`needsProfile`) e cria quando ele vem.
   * Conta criada assim não tem senha utilizável; o acesso é sempre pela plataforma.
   */
  async socialLogin(input: SocialLoginInput): Promise<AuthResult | SocialNeedsProfile> {
    const { users, identities, verifier, hasher, clock, ids } = this.deps;
    const provider = asString(input.provider).toUpperCase();
    if (provider !== 'GOOGLE' && provider !== 'APPLE') throw validationError('Plataforma inválida', { provider: 'Plataforma inválida' });
    if (!verifier.providers().some((p) => p.provider === provider)) throw validationError('Esse tipo de login não está disponível', { provider: 'Indisponível' });
    const idToken = asString(input.idToken);
    const claims = idToken !== '' ? await verifier.verify(provider, idToken) : undefined;
    if (!claims) throw unauthorized('Não foi possível entrar com essa conta');

    const now = clock.now();
    const linkedId = await identities.find(provider, claims.subject);
    if (linkedId) return this.sessionFor(linkedId);

    const email = claims.email && claims.emailVerified ? normalizeEmail(claims.email) : '';
    if (email === '' || emailProblem(email)) throw validationError('A conta não trouxe um e-mail verificado', { provider: 'Use uma conta com e-mail verificado' });

    // Só e-mail verificado pela plataforma pode se juntar a uma conta que já existe.
    const existing = await users.findByEmail(email);
    if (existing) {
      await identities.link(provider, claims.subject, existing.id, now);
      return this.sessionFor(existing.id);
    }

    const rawUsername = asString(input.username);
    const displayName0 = normalizeDisplayName(asString(input.displayName) || claims.name || '');
    if (rawUsername.trim() === '') {
      return { needsProfile: true, suggestedUsername: await this.freeUsername(email), displayName: displayName0 };
    }
    const username = normalizeUsername(rawUsername);
    const displayName = displayName0 === '' ? username : displayName0;
    assertNoProblems({ username: usernameProblem(username), displayName: displayNameProblem(displayName) });
    if (await users.findProfileByUsername(username)) {
      throw conflict('Este nome de usuário já está em uso', { username: 'Este nome de usuário já está em uso' });
    }

    const user: User = { id: ids.next(), email, passwordHash: await hasher.hash(randomBytes(32).toString('hex')), status: 'ACTIVE', role: 'USER', createdAt: now };
    const profile: Profile = { userId: user.id, username, displayName, bio: null, avatarUrl: null, isPrivate: false };
    await users.create(user, profile);
    await identities.link(provider, claims.subject, user.id, now);
    return this.session(user, profile);
  }

  private async sessionFor(userId: string): Promise<AuthResult> {
    const user = await this.deps.users.findById(userId);
    const profile = user ? await this.deps.users.findProfileById(user.id) : undefined;
    if (!user || !profile) throw unauthorized();
    if (user.status === 'SUSPENDED') throw forbidden('Conta suspensa');
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
    if (!user || user.status === 'SUSPENDED') return started;
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
  async confirmPasswordReset(input: { identifier: unknown; code: unknown; password: unknown }): Promise<AuthResult> {
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
    return this.session({ ...user, passwordHash }, profile);
  }

  /** Login por e-mail ou por nome de usuário (com ou sem @). */
  async login(input: LoginInput): Promise<AuthResult> {
    const { users, hasher } = this.deps;
    const identifier = asString(input.identifier).trim();
    const password = asString(input.password);
    if (identifier.length === 0 || identifier.length > 254) throw unauthorized();
    if (password.length === 0 || password.length > PASSWORD_MAX) throw unauthorized();

    const user = await this.findByIdentifier(identifier);
    // Sempre calcula um hash, mesmo sem usuário, para não revelar pelo tempo se a conta existe.
    const stored = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await hasher.verify(password, stored);
    if (!user || !passwordOk) throw unauthorized();

    if (user.status === 'SUSPENDED') throw forbidden('Conta suspensa');

    const profile = await users.findProfileById(user.id);
    if (!profile) throw unauthorized();
    return this.session(user, profile);
  }

  /**
   * Valida o token e confere o usuário no banco a cada chamada, para que
   * suspensão e mudança de papel valham imediatamente.
   */
  async authenticate(token: unknown): Promise<Actor> {
    const raw = asString(token);
    const claims = raw ? this.deps.tokens.verify(raw) : undefined;
    if (!claims) throw unauthorized('Sessão inválida');
    const user = await this.deps.users.findById(claims.userId);
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    return { userId: user.id, role: user.role };
  }

  /** Dados da própria sessão (inclui o e-mail, que só o dono vê). */
  async me(actor: Actor): Promise<SessionUser> {
    const user = await this.deps.users.findById(actor.userId);
    const profile = user ? await this.deps.users.findProfileById(user.id) : undefined;
    if (!user || !profile || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    return { id: user.id, email: user.email, role: user.role, profile: toPublicProfile(profile) };
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

  private session(user: User, profile: Profile): AuthResult {
    return {
      user: { id: user.id, email: user.email, role: user.role, profile: toPublicProfile(profile) },
      token: this.deps.tokens.issue({ userId: user.id, role: user.role }),
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
