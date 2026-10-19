import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { IdentityVerifier } from '../../core/ports.ts';
import type { ExternalProvider, IdentityClaims } from '../../core/types.ts';

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

interface ProviderSpec {
  keysUrl: string;
  issuers: readonly string[];
}

const SPECS: Record<ExternalProvider, ProviderSpec> = {
  GOOGLE: { keysUrl: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
  APPLE: { keysUrl: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
};

const KEYS_TTL_MS = 3_600_000;
const CLOCK_SKEW_S = 60;

export interface OidcVerifierOptions {
  /** ID do aplicativo no Google (client ID web). Sem ele, o login Google fica desligado. */
  googleClientId?: string;
  /** ID de serviço da Apple ("Services ID"). Sem ele, o login Apple fica desligado. */
  appleClientId?: string;
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => Date;
}

const b64urlJson = (part: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Confere o "id_token" (JWT RS256) que o Google e a Apple entregam ao navegador: assinatura com as chaves públicas
 * da plataforma, emissor, público (nosso aplicativo) e validade. Só depois disso a API confia no que o token diz.
 */
export class OidcIdentityVerifier implements IdentityVerifier {
  private readonly clients: Partial<Record<ExternalProvider, string>>;
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly now: () => Date;
  private readonly cache = new Map<ExternalProvider, { keys: Jwk[]; at: number }>();

  constructor(options: OidcVerifierOptions) {
    this.clients = {};
    if (options.googleClientId) this.clients.GOOGLE = options.googleClientId;
    if (options.appleClientId) this.clients.APPLE = options.appleClientId;
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? (() => new Date());
  }

  providers(): { provider: ExternalProvider; clientId: string }[] {
    return (Object.entries(this.clients) as [ExternalProvider, string][]).map(([provider, clientId]) => ({ provider, clientId }));
  }

  async verify(provider: ExternalProvider, idToken: string): Promise<IdentityClaims | undefined> {
    const clientId = this.clients[provider];
    if (!clientId || idToken.length > 8192) return undefined;
    const parts = idToken.split('.');
    if (parts.length !== 3) return undefined;
    const [h, p, s] = parts as [string, string, string];
    const header = b64urlJson(h);
    const payload = b64urlJson(p);
    if (!header || !payload || header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') return undefined;

    const jwk = await this.findKey(provider, header['kid']);
    if (!jwk) return undefined;
    let ok = false;
    try {
      ok = verifySignature('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }), Buffer.from(s, 'base64url'));
    } catch {
      return undefined;
    }
    if (!ok) return undefined;

    const spec = SPECS[provider];
    const aud = payload['aud'];
    const audOk = typeof aud === 'string' ? aud === clientId : Array.isArray(aud) && aud.includes(clientId);
    const exp = payload['exp'];
    const nowS = this.now().getTime() / 1000;
    if (typeof payload['iss'] !== 'string' || !spec.issuers.includes(payload['iss']) || !audOk) return undefined;
    if (typeof exp !== 'number' || exp + CLOCK_SKEW_S < nowS) return undefined;
    const sub = payload['sub'];
    if (typeof sub !== 'string' || sub === '' || sub.length > 255) return undefined;

    const email = typeof payload['email'] === 'string' && payload['email'] !== '' ? payload['email'] : null;
    // O Google manda booleano; a Apple às vezes manda a palavra "true".
    const verified = payload['email_verified'] === true || payload['email_verified'] === 'true';
    return { subject: sub, email, emailVerified: email !== null && verified, name: typeof payload['name'] === 'string' ? payload['name'] : null };
  }

  private async findKey(provider: ExternalProvider, kid: string): Promise<Jwk | undefined> {
    const now = this.now().getTime();
    let entry = this.cache.get(provider);
    // Chave desconhecida: a plataforma pode ter girado as chaves, então busca de novo (no máximo uma vez por minuto).
    const stale = !entry || now - entry.at > KEYS_TTL_MS;
    const missing = entry && !entry.keys.some((k) => k.kid === kid) && now - entry.at > 60_000;
    if (stale || missing) {
      try {
        const body = (await this.fetchJson(SPECS[provider].keysUrl)) as { keys?: Jwk[] };
        entry = { keys: Array.isArray(body.keys) ? body.keys.filter((k) => k.kty === 'RSA') : [], at: now };
        this.cache.set(provider, entry);
      } catch {
        if (!entry) return undefined;
      }
    }
    return entry?.keys.find((k) => k.kid === kid);
  }
}
