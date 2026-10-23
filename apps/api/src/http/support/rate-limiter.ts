/**
 * Limitador de requisições em memória (janela deslizante).
 * Vale para UMA instância da API: se rodar mais de uma, cada uma conta separado (o limite efetivo fica N vezes maior).
 * Quando isso acontecer, troque por um contador compartilhado (Redis ou o próprio Postgres).
 */
export interface Verdict {
  allowed: boolean;
  /** Segundos até a próxima tentativa poder passar (só quando recusado). */
  retryAfterSeconds: number;
}

const MAX_KEYS = 200_000;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sinceSweep = 0;

  /** Conta uma tentativa para `key`. Tentativa recusada não aumenta a contagem. */
  hit(key: string, limit: number, windowMs: number, now: number): Verdict {
    const from = now - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= limit) {
      this.hits.set(key, list);
      const oldest = list[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }
    list.push(now);
    // Chave nova com a tabela cheia: deixa passar (fail-open) em vez de derrubar a API.
    if (this.hits.has(key) || this.hits.size < MAX_KEYS) this.hits.set(key, list);
    this.sinceSweep += 1;
    if (this.sinceSweep >= 2000) this.sweep(now, windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Remove chaves sem tentativas recentes para a memória não crescer. */
  private sweep(now: number, windowMs: number): void {
    this.sinceSweep = 0;
    // A janela maior usada hoje é 1 hora; guarda o dobro por segurança.
    const keep = Math.max(windowMs, 3_600_000) * 2;
    for (const [key, list] of this.hits) {
      const last = list[list.length - 1];
      if (last === undefined || last < now - keep) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
