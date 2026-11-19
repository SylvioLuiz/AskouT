import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketOf, buildExperimentReport, groupOf, proportionDiff } from './reco-experiment.ts';
import type { RecoExperimentConfig } from './reco-experiment.ts';
import { dayOf } from './retention.ts';
import type { DwellRecord } from './types.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const cfg = (over: Partial<RecoExperimentConfig> = {}): RecoExperimentConfig => ({ enabled: true, controlPercent: 20, salt: 'sal', startedAt: '2026-10-01T12:00:00Z', endedAt: null, ...over });
const ids = Array.from({ length: 5000 }, (_, i) => `user-${i}`);

describe('sorteio do teste A/B', () => {
  it('é estável: a mesma pessoa cai sempre no mesmo grupo', () => {
    const c = cfg();
    const first = ids.map((id) => groupOf(id, c));
    assert.deepEqual(ids.map((id) => groupOf(id, c)), first);
    assert.equal(bucketOf('user-1', 'sal'), bucketOf('user-1', 'sal'));
  });

  it('o tamanho do controle fica perto do pedido, e o sal muda o sorteio', () => {
    for (const pct of [10, 20, 50]) {
      const share = ids.filter((id) => groupOf(id, cfg({ controlPercent: pct })) === 'control').length / ids.length;
      assert.ok(Math.abs(share - pct / 100) < 0.03, `${pct}% pedido, ${share} sorteado`);
    }
    assert.equal(ids.filter((id) => groupOf(id, cfg({ controlPercent: 0 })) === 'control').length, 0);
    assert.notDeepEqual(ids.map((id) => groupOf(id, cfg({ salt: 'outro' }))), ids.map((id) => groupOf(id, cfg())));
  });

  it('aumentar o controle só acrescenta gente: ninguém do controle volta para o tratamento', () => {
    const small = new Set(ids.filter((id) => groupOf(id, cfg({ controlPercent: 10 })) === 'control'));
    const big = new Set(ids.filter((id) => groupOf(id, cfg({ controlPercent: 30 })) === 'control'));
    for (const id of small) assert.ok(big.has(id));
    assert.ok(big.size > small.size);
  });
});

describe('diferença de proporções', () => {
  it('calcula a diferença e o intervalo de confiança de 95%', () => {
    const d = proportionDiff({ n: 400, k: 200 }, { n: 400, k: 160 })!;
    assert.ok(Math.abs(d.diff - 0.1) < 1e-9);
    const se = Math.sqrt((0.5 * 0.5) / 400 + (0.4 * 0.6) / 400);
    assert.ok(Math.abs(d.low - (0.1 - 1.96 * se)) < 1e-9 && Math.abs(d.high - (0.1 + 1.96 * se)) < 1e-9);
    assert.equal(d.significant, true);
  });

  it('não é significativo quando o intervalo inclui zero, nem com poucos dados', () => {
    assert.equal(proportionDiff({ n: 100, k: 50 }, { n: 100, k: 47 })!.significant, false);
    assert.equal(proportionDiff({ n: 10, k: 10 }, { n: 10, k: 0 })!.significant, false, 'menos de 30 por grupo nunca conclui');
    assert.equal(proportionDiff({ n: 0, k: 0 }, { n: 5, k: 1 }), null);
  });
});

describe('painel do teste', () => {
  const NOW = new Date('2026-10-20T15:00:00Z');
  let n = 0;
  const row = (userId: string, daysAgo: number, over: Partial<DwellRecord> = {}): DwellRecord => {
    n += 1;
    return { id: `r${n}`, userId, targetType: 'POST', targetId: `t${n}`, ms: 3000, source: 'FEED', createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000), ...over };
  };
  const c = cfg({ controlPercent: 50 });
  const inGroup = (g: 'control' | 'treatment', k: number) => ids.filter((id) => groupOf(id, c) === g).slice(0, k);

  it('conta quem voltou em D1 e D7 por grupo, uma vez por pessoa, e ignora o bloco "Para você"', () => {
    const [c1, c2] = inGroup('control', 2) as [string, string];
    const [t1, t2] = inGroup('treatment', 2) as [string, string];
    const rows = [
      row(c1, 10), row(c1, 9), row(c1, 3), // primeiro dia 10: volta em D1 (dia 9) e em D7 (dia 3)
      row(c2, 10), // sem volta
      row(t1, 10), row(t1, 9), row(t1, 3), row(t1, 2), row(t1, 1), // volta em D1 (dia 9) e em D7 (dia 3)
      row(t2, 10, { source: 'RECO' }), row(t2, 9, { source: 'RECO' }), // só bloco: não é atividade
      row(t2, 4), // primeiro dia 4: D1 (dia 3) não; D7 ainda não passou
    ];
    const r = buildExperimentReport(rows, NOW, c);
    assert.deepEqual([r.control.users, r.treatment.users], [2, 2]);
    assert.deepEqual([r.control.d1.sample, r.control.d1.returned, r.control.d7.sample, r.control.d7.returned], [2, 1, 2, 1]);
    assert.deepEqual([r.treatment.d1.sample, r.treatment.d1.returned, r.treatment.d7.sample, r.treatment.d7.returned], [2, 1, 1, 1]);
    assert.equal(r.lowData, true);
    assert.equal(r.d1Diff!.significant, false);
  });

  it('só vale do início da medição em diante e termina quando o teste foi desligado', () => {
    const [c1] = inGroup('control', 1) as [string];
    const rows = [row(c1, 15), row(c1, 14), row(c1, 5), row(c1, 4)];
    const start = new Date(NOW.getTime() - 6 * 86_400_000);
    const r = buildExperimentReport(rows, NOW, cfg({ controlPercent: 50, startedAt: start.toISOString(), endedAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString() }));
    assert.equal(r.from, dayOf(start));
    assert.equal(r.control.users, 1);
    assert.deepEqual([r.control.d1.sample, r.control.d1.returned], [1, 1], 'o primeiro dia dentro da medição é o dia 5');
  });

  it('com gente suficiente nos dois grupos aponta diferença', () => {
    const rows: DwellRecord[] = [];
    inGroup('treatment', 300).forEach((id, i) => { rows.push(row(id, 5)); if (i % 10 < 8) rows.push(row(id, 4)); });
    inGroup('control', 300).forEach((id, i) => { rows.push(row(id, 5)); if (i % 10 < 4) rows.push(row(id, 4)); });
    const r = buildExperimentReport(rows, NOW, c);
    assert.equal(r.d1Diff!.significant, true);
    assert.equal(r.lowData, true, 'D7 ainda sem amostra: o aviso continua');
    assert.ok(r.d1Diff!.diff > 0.3);
    assert.equal(r.d7Diff, null, 'D7 ainda não passou para ninguém');
  });
});

describe('chave do teste no painel e no bloco', () => {
  async function setup() {
    const w = makeWorld();
    const u = await w.signUpMany('adm', 'ana', 'bia');
    w.users.users.set(u['adm']!, { ...w.users.users.get(u['adm']!)!, role: 'ADMIN' });
    const A = { userId: u['adm']!, role: 'ADMIN' as const };
    return { w, A, ana: u['ana']!, bia: u['bia']! };
  }

  it('começa desligado, só a gestão muda, valida o tamanho e registra na Auditoria', async () => {
    const { w, A, ana } = await setup();
    const U = { userId: ana, role: 'USER' as const };
    const s0 = await w.core.admin.recoExperimentState(A);
    assert.deepEqual([s0.enabled, s0.controlPercent, s0.maxPercent, s0.startedAt], [false, 0, 50, null]);
    await rejectsWith(w.core.admin.recoExperimentState(U), 'FORBIDDEN');
    await rejectsWith(w.core.admin.setRecoExperiment(U, true, 10, null), 'FORBIDDEN');
    await rejectsWith(w.core.admin.setRecoExperiment(A, 'sim', 10, null), 'VALIDATION');
    await rejectsWith(w.core.admin.setRecoExperiment(A, true, 51, null), 'VALIDATION');
    await rejectsWith(w.core.admin.setRecoExperiment(A, true, 12.5, null), 'VALIDATION');
    await rejectsWith(w.core.admin.setRecoExperiment(A, false, 0, null), 'CONFLICT');

    const on = await w.core.admin.setRecoExperiment(A, true, 20, 'Primeira rodada');
    assert.deepEqual([on.enabled, on.controlPercent, on.updatedBy], [true, 20, 'adm']);
    await rejectsWith(w.core.admin.setRecoExperiment(A, true, 20, null), 'CONFLICT');
    await w.core.admin.setRecoExperiment(A, true, 30, null);
    const off = await w.core.admin.setRecoExperiment(A, false, 30, 'Fim');
    assert.equal(off.enabled, false);
    assert.ok(off.endedAt);
    const actions = (await w.core.admin.audit(A, {})).items.map((a) => a.action).filter((a) => a.startsWith('RECO_'));
    assert.deepEqual(actions.sort(), ['RECO_EXPERIMENT_CHANGED', 'RECO_EXPERIMENT_DISABLED', 'RECO_EXPERIMENT_ENABLED']);
  });

  it('informa o grupo, esvazia o bloco do controle e, ao desligar, volta tudo ao normal', async () => {
    const { w, A, ana, bia } = await setup();
    const view = (id: string) => w.core.recommendations.recommend(id);
    assert.equal((await view(ana)).group, null);
    await w.core.admin.setRecoExperiment(A, true, 50, null);
    const ga = (await view(ana)).group;
    assert.ok(ga === 'control' || ga === 'treatment');
    assert.equal((await view(ana)).group, ga, 'estável entre pedidos');
    assert.notEqual((await view(bia)).group, null);
    if (ga === 'control') assert.deepEqual((await view(ana)).items, []);
    await w.core.admin.setRecoExperiment(A, false, 50, null);
    assert.equal((await view(ana)).group, null);
    await w.core.admin.setRecoExperiment(A, true, 50, null);
    assert.equal((await view(ana)).group, ga, 'religar mantém o sal: ninguém troca de grupo');
  });

  it('o painel de Retenção traz a comparação só depois que o teste existe', async () => {
    const { w, A } = await setup();
    assert.equal((await w.core.admin.retention(A, {})).experiment, null);
    await w.core.admin.setRecoExperiment(A, true, 50, null);
    const r = await w.core.admin.retention(A, {});
    assert.equal(r.experiment?.enabled, true);
    assert.equal(r.experiment?.controlPercent, 50);
  });
});
