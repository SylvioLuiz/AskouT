import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HunterBridge } from '../../core/hunter-bridge.ts';
import { syncFromHunter } from '../../core/hunter-sync.ts';
import type { AckResult, FeedItem, HunterFeed, SyncReport } from '../../core/hunter-sync.ts';
import { HUNTER_BRIDGE } from './hunter-token.ts';
import { HunterLog } from './hunter-log.ts';

const EVERY_MS = 10 * 60_000;

/** Lê do Hunter (HUNTER_URL + HUNTER_EXPORT_TOKEN, definidos só no servidor). Sem as duas variáveis, a busca fica inativa. */
export function httpFeed(baseUrl: string, token: string): HunterFeed {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return {
    async fetchApproved(): Promise<FeedItem[]> {
      const res = await fetch(`${base}/export`, { headers, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`Hunter respondeu ${res.status}`);
      const json = (await res.json()) as { candidates?: FeedItem[] };
      return Array.isArray(json.candidates) ? json.candidates : [];
    },
    async ack(key: string, result: AckResult, ref?: string): Promise<void> {
      const res = await fetch(`${base}/export/ack`, { method: 'POST', headers, body: JSON.stringify({ key, result, ref }), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Hunter respondeu ${res.status} ao confirmar`);
    },
  };
}

/** Rodadas do próprio Hunter (coleta nas fontes e busca com IA), lidas de `GET /export/runs` com o mesmo token da exportação. */
export interface HunterRun { startedAt: string; finishedAt: string; trigger: 'agendada' | 'manual'; engine: string; found: number; skippedNiche: number; skippedArea: number; byDecision: Record<string, number>; error?: string; note?: string }

export async function fetchHunterRuns(baseUrl: string, token: string): Promise<{ runs: HunterRun[]; lastRun: string | null; schedule: { enabled: boolean; hours: number[] } | null }> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/export/runs`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90_000) });
  // O painel gratuito do Hunter dorme e o registro só existe nas versões novas: 404 quer dizer Hunter desatualizado.
  if (res.status === 404) throw new Error('O Hunter ainda não tem o registro de rodadas (falta publicar a versão nova do Hunter)');
  if (!res.ok) throw new Error(`Hunter respondeu ${res.status}`);
  const json = (await res.json()) as { runs?: HunterRun[]; lastRun?: string | null; schedule?: { enabled: boolean; hours: number[] } | null };
  return { runs: Array.isArray(json.runs) ? json.runs.slice(0, 100) : [], lastRun: json.lastRun ?? null, schedule: json.schedule ?? null };
}

/** A gestão busca no Hunter e publica sozinha, a cada 10 minutos, enquanto o Hunter estiver ligado na aba da gestão. */
@Injectable()
export class HunterSync implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly bridge: HunterBridge;
  private readonly log = new Logger('HunterSync');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  last: (SyncReport & { error?: string }) | undefined;

  private readonly runLog: HunterLog;

  constructor(@Inject(HUNTER_BRIDGE) bridge: HunterBridge, @Inject(HunterLog) runLog: HunterLog) {
    this.bridge = bridge;
    this.runLog = runLog;
  }

  get configured(): boolean {
    return !!process.env['HUNTER_URL'] && (process.env['HUNTER_EXPORT_TOKEN'] ?? '').length >= 32;
  }

  onApplicationBootstrap(): void {
    if (!this.configured) return;
    this.timer = setInterval(() => void this.run({ trigger: 'AUTO' }), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Uma busca no Hunter. Fica no registro da aba Hunter quando é manual, quando achou algo ou quando falhou (a automática
   * vazia, a cada 10 minutos, só atualiza "Última busca", para o registro não virar ruído).
   */
  async run(opts: { trigger: 'AUTO' | 'MANUAL'; by?: string } = { trigger: 'MANUAL' }): Promise<(SyncReport & { error?: string }) | { error: string }> {
    if (!this.configured) {
      const error = 'Defina HUNTER_URL e HUNTER_EXPORT_TOKEN no servidor';
      if (opts.trigger === 'MANUAL') await this.runLog.append({ at: new Date().toISOString(), kind: 'SYNC', trigger: 'MANUAL', ...(opts.by ? { by: opts.by } : {}), summary: 'Busca no Hunter não rodou', error });
      return { error };
    }
    if (this.running) return this.last ?? { error: 'Já está buscando' };
    this.running = true;
    try {
      const report = await syncFromHunter(this.bridge, httpFeed(process.env['HUNTER_URL'] as string, process.env['HUNTER_EXPORT_TOKEN'] as string));
      this.last = report;
      if (report.seen > 0) this.log.log(`Busca no Hunter: ${JSON.stringify(report)}`);
      if (opts.trigger === 'MANUAL' || report.seen > 0) {
        const summary = report.stoppedDisabled ? 'Hunter desligado na gestão: nada foi buscado' : `${report.seen} aprovado(s) no Hunter: ${report.published} publicado(s), ${report.review} para revisão, ${report.rejected} duplicado(s)`;
        await this.runLog.append({ at: report.at, kind: 'SYNC', trigger: opts.trigger, ...(opts.by ? { by: opts.by } : {}), summary });
      }
      return report;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.last = { at: new Date().toISOString(), seen: 0, published: 0, review: 0, rejected: 0, stoppedDisabled: false, error };
      this.log.error(`Falha ao buscar no Hunter: ${error}`);
      await this.runLog.append({ at: this.last.at, kind: 'SYNC', trigger: opts.trigger, ...(opts.by ? { by: opts.by } : {}), summary: 'Busca no Hunter falhou', error });
      return this.last;
    } finally {
      this.running = false;
    }
  }
}
