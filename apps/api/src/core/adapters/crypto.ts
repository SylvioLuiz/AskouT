import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { OneTimeCodes, PasswordHasher, TokenClaims, TokenService } from '../ports.ts';
import type { UserRole } from '../types.ts';

/**
 * Implementações com `node:crypto`, sem dependências externas.
 * Ficam atrás das portas PasswordHasher e TokenService: dá para trocar por
 * argon2id e uma biblioteca de JWT (ex.: jose, @nestjs/jwt) sem mexer nas regras.
 */

// ---------- Senhas: scrypt ----------

export interface ScryptParams {
  /** Custo (potência de 2). Padrão 2^15, ~32 MB de memória por hash. */
  N: number;
  r: number;
  p: number;
}

const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// Limite para um hash adulterado não forçar custo absurdo na verificação.
const MAX_N = 2 ** 20;

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const maxmem = 256 * params.N * params.r + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: params.N, r: params.r, p: params.p, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export class ScryptPasswordHasher implements PasswordHasher {
  private readonly params: ScryptParams;

  constructor(params: Partial<ScryptParams> = {}) {
    this.params = { ...DEFAULT_SCRYPT, ...params };
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await deriveKey(password, salt, this.params);
    const { N, r, p } = this.params;
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const saltB64 = parts[4];
    const keyB64 = parts[5];
    if (!saltB64 || !keyB64) return false;
    if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return false;
    if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

    const actual = await deriveKey(password, salt, { N, r, p });
    return timingSafeEqual(actual, expected);
  }
}

// ---------- Tokens: JWT HS256 ----------

export interface Hs256Options {
  secret: string;
  /** Validade do token em segundos. Padrão: 1 hora. */
  ttlSeconds?: number;
  /** Relógio em milissegundos (injetável em testes). */
  nowMs?: () => number;
}

const ROLES: ReadonlySet<string> = new Set<UserRole>(['USER', 'VENUE_OWNER', 'ADMIN']);
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

export class Hs256TokenService implements TokenService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly nowMs: () => number;

  constructor(options: Hs256Options) {
    if (typeof options.secret !== 'string' || options.secret.length < 32) {
      throw new Error('O segredo do token precisa ter ao menos 32 caracteres');
    }
    this.secret = options.secret;
    this.ttlSeconds = options.ttlSeconds ?? 3600;
    this.nowMs = options.nowMs ?? Date.now;
  }

  issue(claims: TokenClaims): string {
    const iat = Math.floor(this.nowMs() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ sub: claims.userId, role: claims.role, iat, exp: iat + this.ttlSeconds }),
    ).toString('base64url');
    const signingInput = `${HEADER}.${payload}`;
    return `${signingInput}.${this.sign(signingInput)}`;
  }

  verify(token: string): TokenClaims | undefined {
    if (typeof token !== 'string') return undefined;
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const [header, payload, signature] = parts as [string, string, string];

    // Aceita somente o cabeçalho exato que emitimos: bloqueia alg=none e troca de algoritmo.
    if (header !== HEADER) return undefined;

    const expected = Buffer.from(this.sign(`${header}.${payload}`));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;

    let data: unknown;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return undefined;
    }
    if (typeof data !== 'object' || data === null) return undefined;
    const { sub, role, exp } = data as Record<string, unknown>;
    if (typeof sub !== 'string' || sub.length === 0) return undefined;
    if (typeof role !== 'string' || !ROLES.has(role)) return undefined;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
    if (Math.floor(this.nowMs() / 1000) >= exp) return undefined;

    return { userId: sub, role: role as UserRole };
  }

  private sign(input: string): string {
    return createHmac('sha256', this.secret).update(input).digest('base64url');
  }
}

// ---------- Códigos de confirmação por e-mail ----------

export interface HmacCodesOptions {
  secret: string;
  /** Gerador alternativo, só para testes. Em produção, usa `crypto.randomInt`. */
  generate?: () => string;
}

/**
 * Código de 6 dígitos (1 milhão de possibilidades): a segurança vem de validade curta,
 * limite de tentativas e de reenvios (regras no AuthService), não do hash. O HMAC com
 * segredo do servidor, amarrado ao e-mail, só evita que um vazamento do banco entregue
 * os códigos em texto puro e que um código valha para outro e-mail.
 */
export class HmacOneTimeCodes implements OneTimeCodes {
  private readonly secret: string;
  private readonly generator: (() => string) | undefined;

  constructor(options: HmacCodesOptions) {
    if (typeof options.secret !== 'string' || options.secret.length < 32) {
      throw new Error('O segredo dos códigos precisa ter ao menos 32 caracteres');
    }
    this.secret = options.secret;
    this.generator = options.generate;
  }

  generate(): string {
    return this.generator ? this.generator() : String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  hash(email: string, code: string): string {
    return createHmac('sha256', this.secret).update(`signup-code:${email}:${code}`).digest('base64url');
  }

  matches(email: string, code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(email, code));
    const expected = Buffer.from(expectedHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
