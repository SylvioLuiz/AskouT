import { rateLimited } from '../../core/errors.ts';
import { RateLimiter } from './rate-limiter.ts';

export interface RateLimitRequest {
  method?: string;
  path?: string;
  url?: string;
  ip?: string;
  body?: unknown;
}

const MIN = 60_000;
const HOUR = 3_600_000;

/** Limite geral por endereço: folgado, porque muita gente no celular divide o mesmo IP da operadora. */
export const GENERAL = { limit: 600, windowMs: MIN };
/** Rotas de entrada e códigos, por endereço. */
export const AUTH_PER_IP = { limit: 30, windowMs: 10 * MIN };
/** Tentativas de adivinhar senha ou código, por conta. */
export const GUESS_PER_ACCOUNT = { limit: 10, windowMs: 15 * MIN };
/** Rotas que mandam e-mail, por conta: evita encher a caixa de alguém. */
export const MAIL_PER_ACCOUNT = { limit: 6, windowMs: HOUR };

const AUTH_ROUTES = new Set(['/auth/login', '/auth/signup', '/auth/signup/resend', '/auth/signup/confirm', '/auth/password-reset', '/auth/password-reset/confirm', '/auth/social']);
/** Campo do corpo que identifica a conta em cada rota. */
const GUESS_ROUTES: Record<string, string> = { '/auth/login': 'identifier', '/auth/signup/confirm': 'email', '/auth/password-reset/confirm': 'identifier' };
const MAIL_ROUTES: Record<string, string> = { '/auth/signup': 'email', '/auth/signup/resend': 'email', '/auth/password-reset': 'identifier' };

function accountKey(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const v = (body as Record<string, unknown>)[field];
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  return t === '' ? undefined : t.slice(0, 200);
}

/** Regras do limite de requisições, sem nada do Nest (testável direto). Recusa lançando RATE_LIMITED com o tempo de espera. */
export class RateLimitPolicy {
  private readonly limiter = new RateLimiter();
  /** Relógio trocável nos testes. */
  now: () => number = () => Date.now();

  check(request: RateLimitRequest): void {
    const now = this.now();
    const ip = request.ip ?? 'desconhecido';
    const raw = (request.path ?? request.url ?? '').split('?')[0] ?? '';
    const path = raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
    const post = (request.method ?? '').toUpperCase() === 'POST';

    const apply = (key: string, rule: { limit: number; windowMs: number }, message: string) => {
      const v = this.limiter.hit(key, rule.limit, rule.windowMs, now);
      if (!v.allowed) throw rateLimited(message, v.retryAfterSeconds);
    };

    apply(`ip:${ip}`, GENERAL, 'Muitas requisições. Espere um instante e tente de novo.');
    if (!post || !AUTH_ROUTES.has(path)) return;
    apply(`auth-ip:${ip}`, AUTH_PER_IP, 'Muitas tentativas de entrada. Espere alguns minutos e tente de novo.');
    const guess = GUESS_ROUTES[path];
    const guessKey = guess ? accountKey(request.body, guess) : undefined;
    if (guessKey) apply(`guess:${guessKey}`, GUESS_PER_ACCOUNT, 'Muitas tentativas para esta conta. Espere alguns minutos e tente de novo.');
    const mail = MAIL_ROUTES[path];
    const mailKey = mail ? accountKey(request.body, mail) : undefined;
    if (mailKey) apply(`mail:${mailKey}`, MAIL_PER_ACCOUNT, 'Muitos pedidos de código para este e-mail. Tente de novo mais tarde.');
  }
}
