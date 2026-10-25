import { createPrivateKey, sign } from 'node:crypto';

/**
 * Conta de serviço do Google (arquivo JSON baixado do Google Cloud/Firebase). Serve para falar com o FCM (aviso no Android)
 * e com a API do Google Play (conferir compras). Sem bibliotecas: JWT RS256 trocado por um token de acesso.
 * O que NÃO foi testado: a troca real com o Google (precisa do arquivo da conta de serviço).
 */

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const ALLOWED_TOKEN_HOST = 'oauth2.googleapis.com';

/** Lê e confere o JSON da conta de serviço. `undefined` se não for um arquivo desse tipo. */
export function parseServiceAccount(raw: string): ServiceAccountCredentials | undefined {
  try {
    const value: unknown = JSON.parse(raw.trim());
    if (!value || typeof value !== 'object') return undefined;
    const v = value as Record<string, unknown>;
    if (typeof v['client_email'] !== 'string' || typeof v['private_key'] !== 'string' || typeof v['project_id'] !== 'string') return undefined;
    if (!/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(v['client_email'])) return undefined;
    const key = createPrivateKey(v['private_key'].replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'rsa') return undefined;
    const tokenUri = typeof v['token_uri'] === 'string' ? v['token_uri'] : DEFAULT_TOKEN_URI;
    if (new URL(tokenUri).hostname !== ALLOWED_TOKEN_HOST) return undefined;
    return { client_email: v['client_email'], private_key: v['private_key'].replace(/\\n/g, '\n'), project_id: v['project_id'], token_uri: tokenUri };
  } catch {
    return undefined;
  }
}

export class GoogleAccessTokens {
  private readonly credentials: ServiceAccountCredentials;
  private readonly fetcher: FetchLike;
  private readonly nowMs: () => number;
  private readonly cache = new Map<string, { token: string; expiresAtMs: number }>();

  constructor(options: { credentials: ServiceAccountCredentials; fetch?: FetchLike; nowMs?: () => number }) {
    this.credentials = options.credentials;
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.nowMs = options.nowMs ?? Date.now;
  }

  get projectId(): string {
    return this.credentials.project_id;
  }

  /** Assertion JWT assinada com a chave da conta de serviço (vale 1 hora). */
  assertion(scope: string, nowSeconds: number): string {
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({ iss: this.credentials.client_email, scope, aud: this.credentials.token_uri ?? DEFAULT_TOKEN_URI, iat: nowSeconds, exp: nowSeconds + 3600 }),
    )}`;
    const signature = sign('RSA-SHA256', Buffer.from(unsigned), createPrivateKey(this.credentials.private_key));
    return `${unsigned}.${b64url(signature)}`;
  }

  /** Token de acesso para o escopo; reaproveita enquanto faltar mais de 5 minutos para vencer. `forceNew` ignora o guardado. */
  async get(scope: string, forceNew = false): Promise<string> {
    const now = this.nowMs();
    const cached = this.cache.get(scope);
    if (!forceNew && cached && cached.expiresAtMs - now > 5 * 60_000) return cached.token;
    const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${this.assertion(scope, Math.floor(now / 1000))}`;
    const response = await this.fetcher(this.credentials.token_uri ?? DEFAULT_TOKEN_URI, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (response.status !== 200) throw new Error(`O Google recusou a conta de serviço (${response.status})`);
    const parsed = JSON.parse(await response.text()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== 'string' || parsed.access_token === '') throw new Error('Resposta do Google sem token de acesso');
    const ttl = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
    this.cache.set(scope, { token: parsed.access_token, expiresAtMs: now + ttl * 1000 });
    return parsed.access_token;
  }
}
