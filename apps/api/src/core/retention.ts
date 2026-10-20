import type { DwellRecord, DwellSource } from './types.ts';

export const RETENTION_TIME_ZONE = 'America/Sao_Paulo';
/** Abaixo disso a taxa é só um palpite: o painel avisa. */
export const RETENTION_MIN_SAMPLE = 30;

export interface SourceStats {
  /** Conteúdos diferentes mostrados (pessoa, conteúdo e dia contam uma vez). */
  impressions: number;
  clicks: number;
  /** clicks / impressions, ou null sem impressões. */
  ctr: number | null;
  avgDwellMs: number | null;
  users: number;
}

export interface DailyStats {
  day: string;
  activeUsers: number;
  feedImpressions: number;
  recoImpressions: number;
  recoClicks: number;
  feedAvgDwellMs: number | null;
  recoAvgDwellMs: number | null;
}

export interface ReturnRate {
  /** Dias-pessoa que já podem ter voltado (o dia de volta já passou). */
  sample: number;
  returned: number;
  rate: number | null;
}

export interface ReturnGroup {
  all: ReturnRate;
  /** Viu o bloco "Para você" naquele dia. */
  withReco: ReturnRate;
  withoutReco: ReturnRate;
}

export interface RetentionReport {
  days: number;
  from: string;
  to: string;
  /** true quando o limite de linhas cortou os dados mais antigos. */
  truncated: boolean;
  sources: Record<'FEED' | 'RECO', SourceStats>;
  daily: DailyStats[];
  /** Voltou no dia seguinte / 7 dias depois de um dia com atividade. */
  d1: ReturnGroup;
  d7: ReturnGroup;
  minSample: number;
}

/** Dia (AAAA-MM-DD) no fuso do Brasil. */
export function dayOf(date: Date, timeZone = RETENTION_TIME_ZONE): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

interface Exposure {
  userId: string;
  day: string;
  source: DwellSource;
  ms: number;
  clicked: boolean;
}

const rate = (returned: number, sample: number): ReturnRate => ({ sample, returned, rate: sample > 0 ? returned / sample : null });
const mean = (xs: number[]): number | null => (xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

/**
 * Monta o painel a partir das medições de tempo na tela.
 * "Atividade" aqui é ter qualquer medição no dia, então só entra quem mantém as recomendações personalizadas ligadas.
 */
export function buildRetentionReport(rows: readonly DwellRecord[], now: Date, days: number, truncated = false): RetentionReport {
  const today = dayOf(now);
  const from = addDay(today, -(days - 1));

  // Uma exposição = pessoa + conteúdo + origem + dia.
  const byKey = new Map<string, Exposure>();
  for (const r of rows) {
    const day = dayOf(r.createdAt);
    if (day < from || day > today) continue;
    const key = `${r.userId}|${r.targetType}|${r.targetId}|${r.source}|${day}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.ms += r.ms;
      cur.clicked = cur.clicked || r.clicked === true;
    } else byKey.set(key, { userId: r.userId, day, source: r.source, ms: r.ms, clicked: r.clicked === true });
  }
  const exposures = [...byKey.values()];

  const sourceStats = (source: DwellSource): SourceStats => {
    const list = exposures.filter((e) => e.source === source);
    const clicks = list.filter((e) => e.clicked).length;
    // Quem só clicou (tempo 0) não entra na média de tempo.
    return { impressions: list.length, clicks, ctr: list.length > 0 ? clicks / list.length : null, avgDwellMs: mean(list.filter((e) => e.ms > 0).map((e) => e.ms)), users: new Set(list.map((e) => e.userId)).size };
  };

  const daily: DailyStats[] = [];
  for (let d = from; d <= today; d = addDay(d, 1)) {
    const list = exposures.filter((e) => e.day === d);
    const feed = list.filter((e) => e.source === 'FEED');
    const reco = list.filter((e) => e.source === 'RECO');
    daily.push({
      day: d,
      activeUsers: new Set(list.map((e) => e.userId)).size,
      feedImpressions: feed.length,
      recoImpressions: reco.length,
      recoClicks: reco.filter((e) => e.clicked).length,
      feedAvgDwellMs: mean(feed.filter((e) => e.ms > 0).map((e) => e.ms)),
      recoAvgDwellMs: mean(reco.filter((e) => e.ms > 0).map((e) => e.ms)),
    });
  }

  // Retorno: para cada (pessoa, dia ativo), a pessoa voltou N dias depois?
  const activity = new Map<string, Set<string>>();
  const sawReco = new Set<string>();
  for (const e of exposures) {
    if (!activity.has(e.userId)) activity.set(e.userId, new Set());
    activity.get(e.userId)!.add(e.day);
    if (e.source === 'RECO') sawReco.add(`${e.userId}|${e.day}`);
  }
  const returnGroup = (n: number): ReturnGroup => {
    const t = { all: [0, 0], withReco: [0, 0], withoutReco: [0, 0] } as Record<'all' | 'withReco' | 'withoutReco', [number, number]>;
    for (const [userId, set] of activity) {
      for (const d of set) {
        if (addDay(d, n) > today) continue; // o dia de volta ainda não terminou/chegou
        const back = set.has(addDay(d, n)) ? 1 : 0;
        const group = sawReco.has(`${userId}|${d}`) ? 'withReco' : 'withoutReco';
        for (const g of ['all', group] as const) {
          t[g][0] += 1;
          t[g][1] += back;
        }
      }
    }
    return { all: rate(t.all[1], t.all[0]), withReco: rate(t.withReco[1], t.withReco[0]), withoutReco: rate(t.withoutReco[1], t.withoutReco[0]) };
  };

  return { days, from, to: today, truncated, sources: { FEED: sourceStats('FEED'), RECO: sourceStats('RECO') }, daily, d1: returnGroup(1), d7: returnGroup(7), minSample: RETENTION_MIN_SAMPLE };
}
