import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../tokens.ts';

const KEY = 'hunter.log';
const KEEP = 150;

/** Uma execução de busca feita pela gestão: a busca no Hunter (publicação) ou a busca de locais no Google. */
export interface HunterLogEntry {
  at: string;
  kind: 'SYNC' | 'GOOGLE_SEARCH' | 'GOOGLE_SAVE';
  trigger: 'AUTO' | 'MANUAL';
  /** Quem disparou (só nas manuais). */
  by?: string;
  summary: string;
  error?: string;
}

/**
 * Registro das buscas da aba Hunter, guardado em `AppSetting` (as 150 mais recentes, sem tabela nova). Falha ao gravar
 * nunca derruba a busca: o registro é só para acompanhar.
 */
@Injectable()
export class HunterLog {
  private readonly prisma: PrismaClient;
  private chain: Promise<void> = Promise.resolve();

  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async list(): Promise<HunterLogEntry[]> {
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
      const parsed: unknown = row ? JSON.parse(row.value) : [];
      return Array.isArray(parsed) ? (parsed as HunterLogEntry[]) : [];
    } catch {
      return [];
    }
  }

  /** Acrescenta no topo. As gravações deste processo vão em fila para uma não apagar a outra. */
  append(entry: HunterLogEntry): Promise<void> {
    this.chain = this.chain.then(async () => {
      const entries = [entry, ...(await this.list())].slice(0, KEEP);
      const value = JSON.stringify(entries);
      const at = new Date(entry.at);
      await this.prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedAt: at }, update: { value, updatedAt: at } });
    }).catch(() => undefined);
    return this.chain;
  }
}
