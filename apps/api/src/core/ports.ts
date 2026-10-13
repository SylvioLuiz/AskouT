import type { Direction, Follow, FollowStatus, Page, PendingSignup, Profile, User, UserRole } from './types.ts';

/**
 * Portas (interfaces) que a lógica de negócio precisa. As implementações reais
 * (Prisma/Postgres, JWT de biblioteca etc.) entram depois, sem mudar as regras.
 */

export interface UserRepository {
  /** Cria usuário e perfil juntos. Lança DomainError CONFLICT se e-mail ou username já existirem. */
  create(user: User, profile: Profile): Promise<void>;
  findById(id: string): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findProfileById(userId: string): Promise<Profile | undefined>;
  findProfileByUsername(username: string): Promise<Profile | undefined>;
  /** Mantém a ordem de `ids`; ignora ausentes e usuários suspensos. */
  findProfilesByIds(ids: string[]): Promise<Profile[]>;
  updateProfile(profile: Profile): Promise<void>;
  /** Busca por prefixo de username ou trecho do nome. Ignora suspensos e `excludeIds`. */
  searchProfiles(query: string, limit: number, excludeIds: string[]): Promise<Profile[]>;
}

export interface FollowRepository {
  get(followerId: string, followeeId: string): Promise<Follow | undefined>;
  /** Insere ou atualiza o status, preservando `createdAt` de uma linha existente. */
  save(follow: Follow): Promise<void>;
  delete(followerId: string, followeeId: string): Promise<boolean>;
  /** Remove o seguimento nos dois sentidos entre a e b. */
  deleteBetween(a: string, b: string): Promise<void>;
  /** Mais recentes primeiro. `followers`: quem segue userId; `following`: quem userId segue. */
  list(userId: string, direction: Direction, status: FollowStatus, page: Page): Promise<Follow[]>;
  count(userId: string, direction: Direction, status: FollowStatus): Promise<number>;
  /** Aceita todas as solicitações pendentes recebidas por followeeId. Retorna quantas. */
  acceptAllPending(followeeId: string): Promise<number>;
  /** Seguimento mútuo aceito, sem bloqueio em nenhum sentido (mesma regra da view `friendships`). */
  listFriendIds(userId: string): Promise<string[]>;
}

export interface BlockRepository {
  /** Idempotente. */
  add(blockerId: string, blockedId: string, createdAt: Date): Promise<void>;
  remove(blockerId: string, blockedId: string): Promise<boolean>;
  exists(blockerId: string, blockedId: string): Promise<boolean>;
  existsEitherWay(a: string, b: string): Promise<boolean>;
  listBlockedBy(blockerId: string): Promise<string[]>;
  /** Todos os usuários com bloqueio em qualquer sentido com `userId`. */
  listRelatedIds(userId: string): Promise<string[]>;
}

export interface PendingSignupRepository {
  find(email: string): Promise<PendingSignup | undefined>;
  /** Insere ou substitui o cadastro pendente daquele e-mail. */
  save(pending: PendingSignup): Promise<void>;
  delete(email: string): Promise<void>;
  /**
   * Soma 1 às tentativas erradas de forma ATÔMICA e devolve o novo total
   * (undefined se o cadastro não existir mais). Atômico para que tentativas
   * simultâneas não furem o limite.
   */
  incrementAttempts(email: string): Promise<number | undefined>;
}

export interface EmailSender {
  /** Falha com erro comum se o e-mail não puder ser enviado. */
  sendSignupCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>;
}

export interface OneTimeCodes {
  /** Código numérico de 6 dígitos, com zeros à esquerda. */
  generate(): string;
  /** Hash do código amarrado ao e-mail, para guardar no banco. */
  hash(email: string, code: string): string;
  /** Comparação em tempo constante. */
  matches(email: string, code: string, expectedHash: string): boolean;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export interface TokenClaims {
  userId: string;
  role: UserRole;
}

export interface TokenService {
  issue(claims: TokenClaims): string;
  /** Retorna undefined para token inválido, adulterado ou expirado. */
  verify(token: string): TokenClaims | undefined;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface CoreDeps {
  users: UserRepository;
  follows: FollowRepository;
  blocks: BlockRepository;
  pending: PendingSignupRepository;
  mailer: EmailSender;
  codes: OneTimeCodes;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  ids: IdGenerator;
}
