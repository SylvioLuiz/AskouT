import { createHash } from 'node:crypto';
import { validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import { addDay, dayOf } from './retention.ts';
import type { DwellRecord } from './types.ts';

/** Chave guardada no banco (um JSON). Só a gestão (painel) altera. */
export const RECO_EXPERIMENT_KEY = 'reco.abtest';
/** Teto do grupo de controle: acima disso o bloco deixa de ser a regra. */
export const RECO_EXPERIMENT_MAX_PERCENT = 50;
/** Abaixo disso (pessoas por grupo) a diferença é só um palpite: o painel avisa. */
export const EXPERIMENT_MIN_SAMPLE = 30;
/** Fatias do sorteio: 10 000 dá passos de 0,01%, mais que suficiente para 0 a 50%. */
const BUCKETS = 10_000;

export type RecoGroup = 'control' | 'treatment';

export interface RecoExperimentConfig {
  enabled: boolean;
  /** Inteiro de 0 a 50: parte das pessoas que NÃO vê o bloco "Para você". */
  controlPercent: number;
  /** Sal do sorteio. Fica o mesmo ao desligar e religar, para ninguém trocar de grupo. */
  salt: string;
  /** Início da medição atual (ISO). Muda quando liga ou quando o tamanho do controle muda, porque aí há gente trocando de grupo. */
  startedAt: string;
  /** Fim da medição (ISO), quando desligada; null enquanto ligada. */
  endedAt: string | null;
}

export interface RecoExperimentState {
  enabled: boolean;
  controlPercent: number;
  maxPercent: number;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Fatia (0 a 9999) da pessoa. Só depende do sal e do id: a mesma pessoa cai sempre na mesma fatia.
 * É controle quando `fatia < percentual * 100`; então aumentar o percentual só acrescenta gente ao controle e ninguém sai dele.
 */
export function bucketOf(userId: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${userId}`).digest();
  return digest.readUInt32BE(0) % BUCKETS;
}

export function groupOf(userId: string, config: Pick<RecoExperimentConfig, 'controlPercent' | 'salt'>): RecoGroup {
  return bucketOf(userId, config.salt) < config.controlPercent * (BUCKETS / 100) ? 'control' : 'treatment';
}

function parse(value: string | undefined): RecoExperimentConfig | null {
  if (value === undefined) return null;
  try {
    const c = JSON.parse(value) as Partial<RecoExperimentConfig>;
    if (typeof c.enabled !== 'boolean' || typeof c.controlPercent !== 'number' || typeof c.salt !== 'string' || typeof c.startedAt !== 'string') return null;
    return { enabled: c.enabled, controlPercent: c.controlPercent, salt: c.salt, startedAt: c.startedAt, endedAt: typeof c.endedAt === 'string' ? c.endedAt : null };
  } catch {
    return null;
  }
}

/**
 * Teste A/B do bloco "Para você": um grupo de controle sorteado de forma estável não vê o bloco.
 * Lido do banco a cada pedido (vale na hora, em qualquer servidor), como a chave de pagamentos.
 * Desligado, ninguém está em grupo nenhum e todo mundo vê o bloco.
 */
export class RecoExperiment {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async config(): Promise<RecoExperimentConfig | null> {
    return parse((await this.deps.settings.get(RECO_EXPERIMENT_KEY))?.value);
  }

  /** Grupo da pessoa agora, ou null com o teste desligado (ou com 0% de controle). */
  async groupFor(userId: string): Promise<RecoGroup | null> {
    const c = await this.config();
    if (!c || !c.enabled || c.controlPercent <= 0) return null;
    return groupOf(userId, c);
  }

  async state(): Promise<RecoExperimentState> {
    const row = await this.deps.settings.get(RECO_EXPERIMENT_KEY);
    const c = parse(row?.value);
    let updatedBy: string | null = null;
    if (row?.updatedBy) updatedBy = (await this.deps.users.findProfileById(row.updatedBy))?.username ?? null;
    return {
      enabled: c?.enabled ?? false,
      controlPercent: c?.controlPercent ?? 0,
      maxPercent: RECO_EXPERIMENT_MAX_PERCENT,
      startedAt: c?.startedAt ?? null,
      endedAt: c?.endedAt ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy,
    };
  }

  async set(enabled: boolean, controlPercent: number, adminId: string): Promise<void> {
    if (!Number.isInteger(controlPercent) || controlPercent < 0 || controlPercent > RECO_EXPERIMENT_MAX_PERCENT) {
      throw validationError('Dados inválidos', { controlPercent: `Número inteiro de 0 a ${RECO_EXPERIMENT_MAX_PERCENT}` });
    }
    const now = this.deps.clock.now();
    const before = await this.config();
    const salt = before?.salt ?? createHash('sha256').update(`${this.deps.ids.next()}:${now.toISOString()}`).digest('hex').slice(0, 24);
    const keep = enabled && before !== null && before.enabled && before.controlPercent === controlPercent;
    const config: RecoExperimentConfig = {
      enabled,
      controlPercent,
      salt,
      // Mexer no tamanho com o teste no ar troca gente de grupo: a medição recomeça. Desligar guarda o período para o painel.
      startedAt: enabled ? (keep ? before.startedAt : now.toISOString()) : (before?.startedAt ?? now.toISOString()),
      endedAt: enabled ? null : before?.enabled ? now.toISOString() : (before?.endedAt ?? now.toISOString()),
    };
    await this.deps.settings.set({ key: RECO_EXPERIMENT_KEY, value: JSON.stringify(config), updatedAt: now, updatedBy: adminId });
  }
}

// ---------- Conta do painel ----------

export interface ProportionDiff {
  /** treatment - control, em fração (0,02 = 2 pontos percentuais). */
  diff: number;
  /** Intervalo de confiança de 95% da diferença. */
  low: number;
  high: number;
  /** O intervalo não inclui zero e os dois grupos têm gente suficiente. */
  significant: boolean;
}

/**
 * Diferença de duas proporções (tratamento menos controle) com intervalo de confiança de 95% (Wald, z = 1,96).
 * Cada pessoa conta uma vez, então as unidades são independentes e a conta vale.
 * `null` se algum grupo estiver vazio.
 */
export function proportionDiff(treatment: { n: number; k: number }, control: { n: number; k: number }, minSample = EXPERIMENT_MIN_SAMPLE): ProportionDiff | null {
  if (treatment.n === 0 || control.n === 0) return null;
  const p1 = treatment.k / treatment.n;
  const p0 = control.k / control.n;
  const se = Math.sqrt((p1 * (1 - p1)) / treatment.n + (p0 * (1 - p0)) / control.n);
  const diff = p1 - p0;
  const low = diff - 1.96 * se;
  const high = diff + 1.96 * se;
  return { diff, low, high, significant: treatment.n >= minSample && control.n >= minSample && (low > 0 || high < 0) };
}

export interface GroupReturn {
  /** Pessoas do grupo com atividade no período. */
  users: number;
  d1: { sample: number; returned: number; rate: number | null };
  d7: { sample: number; returned: number; rate: number | null };
}

export interface ExperimentReport {
  enabled: boolean;
  controlPercent: number;
  /** Dias (AAAA-MM-DD, Brasília) em que a medição vale. */
  from: string;
  to: string;
  control: GroupReturn;
  treatment: GroupReturn;
  /** Diferença tratamento - controle; null sem gente nos dois grupos. */
  d1Diff: ProportionDiff | null;
  d7Diff: ProportionDiff | null;
  /** true quando algum grupo tem menos de `minSample` pessoas em D1 ou D7. */
  lowData: boolean;
  minSample: number;
}

/**
 * Painel do teste: quem voltou em D1 e D7 no controle e no tratamento.
 *
 * Medida de atividade: tempo medido no FEED (Home, Explorar, posts de um local). Não usa nenhuma medição do bloco "Para você",
 * porque o controle não vê o bloco e ficaria sempre com menos atividade só por isso. O feed existe igual nos dois grupos.
 * Limite: o tempo na tela só é medido de quem mantém as recomendações personalizadas ligadas; essas pessoas, nos dois grupos, são o universo medido.
 *
 * Unidade: a PESSOA, no primeiro dia ativo dela dentro da medição. Contar todo dia ativo repetiria a mesma pessoa e deixaria o intervalo
 * estreito demais. Só entra em D1 / D7 quem tem esse dia de volta já passado.
 */
export function buildExperimentReport(rows: readonly DwellRecord[], now: Date, config: RecoExperimentConfig): ExperimentReport {
  const today = dayOf(now);
  const from = dayOf(new Date(config.startedAt));
  const to = config.endedAt ? dayOf(new Date(config.endedAt)) : today;

  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.source !== 'FEED') continue;
    const day = dayOf(r.createdAt);
    if (day > today) continue;
    if (!days.has(r.userId)) days.set(r.userId, new Set());
    days.get(r.userId)!.add(day);
  }

  const tally = () => ({ users: 0, d1: { n: 0, k: 0 }, d7: { n: 0, k: 0 } });
  const t = { control: tally(), treatment: tally() };
  for (const [userId, set] of days) {
    const first = [...set].filter((d) => d >= from && d <= to).sort()[0];
    if (first === undefined) continue;
    const g = t[groupOf(userId, config)];
    g.users += 1;
    for (const [n, key] of [[1, 'd1'], [7, 'd7']] as const) {
      if (addDay(first, n) > today) continue;
      g[key].n += 1;
      if (set.has(addDay(first, n))) g[key].k += 1;
    }
  }
  const ret = (g: { n: number; k: number }) => ({ sample: g.n, returned: g.k, rate: g.n > 0 ? g.k / g.n : null });
  const group = (g: ReturnType<typeof tally>): GroupReturn => ({ users: g.users, d1: ret(g.d1), d7: ret(g.d7) });
  const lowData = (['d1', 'd7'] as const).some((k) => t.control[k].n < EXPERIMENT_MIN_SAMPLE || t.treatment[k].n < EXPERIMENT_MIN_SAMPLE);
  return {
    enabled: config.enabled,
    controlPercent: config.controlPercent,
    from,
    to,
    control: group(t.control),
    treatment: group(t.treatment),
    d1Diff: proportionDiff(t.treatment.d1, t.control.d1),
    d7Diff: proportionDiff(t.treatment.d7, t.control.d7),
    lowData,
    minSample: EXPERIMENT_MIN_SAMPLE,
  };
}
