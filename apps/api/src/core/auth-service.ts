import { conflict, forbidden, unauthorized } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { Actor, Profile, PublicProfile, User, UserRole } from './types.ts';
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

export interface RegisterInput {
  email: unknown;
  username: unknown;
  displayName?: unknown;
  password: unknown;
}

export interface LoginInput {
  email: unknown;
  password: unknown;
}

export class AuthService {
  private readonly deps: CoreDeps;
  private dummyHash: Promise<string> | undefined;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const { users, hasher, clock, ids } = this.deps;
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

    const user: User = {
      id: ids.next(),
      email,
      passwordHash: await hasher.hash(password),
      status: 'ACTIVE',
      role: 'USER',
      createdAt: clock.now(),
    };
    const profile: Profile = {
      userId: user.id,
      username,
      displayName,
      bio: null,
      avatarUrl: null,
      isPrivate: false,
    };
    // Em corrida, o repositório lança CONFLICT pela restrição de unicidade.
    await users.create(user, profile);
    return this.session(user, profile);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const { users, hasher } = this.deps;
    const email = normalizeEmail(asString(input.email));
    const password = asString(input.password);
    if (password.length === 0 || password.length > PASSWORD_MAX) throw unauthorized();

    const user = await users.findByEmail(email);
    // Sempre calcula um hash, mesmo sem usuário, para não revelar pelo tempo se o e-mail existe.
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
