/** Único ponto de contato com o AskouT: endpoints de serviço com Bearer token. */
export interface AskoutConfig { baseUrl: string; token: string; fetchImpl?: typeof fetch }

export class AskoutError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export class AskoutClient {
  constructor(private readonly cfg: AskoutConfig) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const f = this.cfg.fetchImpl ?? fetch;
    const res = await f(`${this.cfg.baseUrl}/hunter${path}`, {
      method,
      headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) throw new AskoutError(res.status, String(json.code ?? json.error ?? 'ERROR'), String(json.message ?? res.statusText));
    return json as T;
  }

  status() { return this.call<{ enabled: boolean }>('GET', '/status'); }
  venues(query: string) { return this.call<unknown>('GET', `/venues?${query}`); }
  regions() { return this.call<unknown>('GET', '/regions'); }
  createEvent(event: Record<string, unknown>) { return this.call<unknown>('POST', '/events', event); }
  cancelEvent(ref: string) { return this.call<unknown>('POST', `/events/${encodeURIComponent(ref)}/cancel`); }
}
