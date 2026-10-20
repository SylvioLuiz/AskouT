import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDay, buildRetentionReport, dayOf, RETENTION_MIN_SAMPLE } from './retention.ts';
import type { DwellRecord } from './types.ts';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld } from './testing/world.ts';

const NOW = new Date('2026-10-20T15:00:00Z'); // 12h em Brasília
let n = 0;
function row(userId: string, daysAgo: number, over: Partial<DwellRecord> = {}): DwellRecord {
  n += 1;
  return { id: `r${n}`, userId, targetType: 'POST', targetId: `t${n}`, ms: 4000, source: 'FEED', clicked: false, createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000), ...over };
}

describe('painel de retenção', () => {
  it('compara o bloco "Para você" com o feed: exibições, cliques, CTR e tempo médio', () => {
    const rows = [
      row('a', 0, { source: 'FEED', ms: 2000 }),
      row('a', 0, { source: 'FEED', ms: 6000 }),
      row('a', 0, { source: 'RECO', ms: 8000, clicked: true, targetId: 'x' }),
      row('b', 0, { source: 'RECO', ms: 4000, targetId: 'y' }),
      row('b', 0, { source: 'RECO', ms: 0, clicked: true, targetId: 'z' }),
    ];
    const r = buildRetentionReport(rows, NOW, 7);
    assert.equal(r.sources.FEED.impressions, 2);
    assert.equal(r.sources.FEED.avgDwellMs, 4000);
    assert.equal(r.sources.RECO.impressions, 3);
    assert.equal(r.sources.RECO.clicks, 2);
    assert.equal(r.sources.RECO.ctr, 2 / 3);
    assert.equal(r.sources.RECO.avgDwellMs, 6000, 'o clique sem tempo não puxa a média');
    assert.equal(r.sources.RECO.users, 2);
  });

  it('o mesmo conteúdo no mesmo dia conta uma vez só (vários envios somam o tempo)', () => {
    const rows = [row('a', 0, { targetId: 'p', ms: 2000 }), row('a', 0, { targetId: 'p', ms: 3000, clicked: true, source: 'RECO' }), row('a', 0, { targetId: 'p', ms: 1000, source: 'RECO' })];
    const r = buildRetentionReport(rows, NOW, 7);
    assert.equal(r.sources.FEED.impressions, 1);
    assert.equal(r.sources.RECO.impressions, 1);
    assert.equal(r.sources.RECO.avgDwellMs, 4000);
    assert.equal(r.sources.RECO.clicks, 1);
  });

  it('série por dia no fuso do Brasil, com os dias sem atividade zerados', () => {
    const lateNight = new Date('2026-10-19T02:30:00Z'); // 23h30 do dia 18 em Brasília
    const rows = [row('a', 0), { ...row('b', 0), createdAt: lateNight }];
    const r = buildRetentionReport(rows, NOW, 4);
    assert.deepEqual(r.daily.map((d) => d.day), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
    assert.deepEqual(r.daily.map((d) => d.activeUsers), [0, 1, 0, 1]);
    assert.equal(dayOf(lateNight), '2026-10-18');
  });

  it('ignora o que está fora do período', () => {
    const r = buildRetentionReport([row('a', 30), row('a', 0)], NOW, 7);
    assert.equal(r.sources.FEED.impressions, 1);
  });

  it('retorno D1 e D7: separa quem viu o bloco naquele dia de quem não viu', () => {
    const rows: DwellRecord[] = [];
    // Dia 10 dias atrás: A viu o bloco e voltou no dia seguinte; B não viu o bloco e não voltou.
    rows.push(row('A', 10, { source: 'RECO' }), row('A', 9), row('B', 10));
    const r = buildRetentionReport(rows, NOW, 14);
    // Dias-pessoa com dia seguinte já passado: A@10 (voltou), A@9 (não voltou em 8), B@10 (não voltou).
    assert.deepEqual(r.d1.withReco, { sample: 1, returned: 1, rate: 1 });
    assert.equal(r.d1.withoutReco.sample, 2);
    assert.equal(r.d1.withoutReco.returned, 0);
    assert.deepEqual(r.d1.all, { sample: 3, returned: 1, rate: 1 / 3 });
    assert.equal(r.d7.all.sample, 3);
    assert.equal(r.d7.all.returned, 0);
  });

  it('não conta como "não voltou" um dia de retorno que ainda não chegou', () => {
    const r = buildRetentionReport([row('A', 0), row('B', 3)], NOW, 14);
    assert.equal(r.d1.all.sample, 1, 'só B@3 já pode ter voltado no dia seguinte');
    assert.equal(r.d7.all.sample, 0);
    assert.equal(r.d7.all.rate, null);
  });

  it('sem dados devolve tudo zerado, sem dividir por zero', () => {
    const r = buildRetentionReport([], NOW, 3);
    assert.equal(r.sources.RECO.ctr, null);
    assert.equal(r.sources.RECO.avgDwellMs, null);
    assert.equal(r.d1.all.rate, null);
    assert.equal(r.daily.length, 3);
    assert.equal(r.minSample, RETENTION_MIN_SAMPLE);
  });

  it('soma de dias', () => {
    assert.equal(addDay('2026-10-31', 1), '2026-11-01');
    assert.equal(addDay('2026-03-01', -1), '2026-02-28');
  });
});

describe('rota do painel', () => {
  async function admin() {
    const w = makeWorld();
    const { ana, adm } = await w.signUpMany('ana', 'adm');
    w.users.users.set(adm!, { ...w.users.users.get(adm!)!, role: 'ADMIN' });
    return { w, ana: { userId: ana!, role: 'USER' as const }, adm: { userId: adm!, role: 'ADMIN' as const } };
  }

  it('só administrador vê, e valida o período', async () => {
    const { w, ana, adm } = await admin();
    await rejectsWith(w.core.admin.retention(ana, {}), 'FORBIDDEN');
    await rejectsWith(w.core.admin.retention(adm, { days: 0 }), 'VALIDATION');
    await rejectsWith(w.core.admin.retention(adm, { days: 61 }), 'VALIDATION');
    await rejectsWith(w.core.admin.retention(adm, { days: 'abc' }), 'VALIDATION');
    assert.equal((await w.core.admin.retention(adm, {})).days, 14);
  });

  it('lê as medições gravadas pelos usuários, inclusive o clique', async () => {
    const { w, ana, adm } = await admin();
    await w.core.dwell.record(ana.userId, [
      { targetType: 'EVENT', targetId: 'e1', ms: 5000, source: 'RECO' },
      { targetType: 'EVENT', targetId: 'e1', ms: 0, source: 'RECO', clicked: true },
      { targetType: 'POST', targetId: 'p1', ms: 3000, source: 'FEED' },
    ]);
    const r = await w.core.admin.retention(adm, { days: 7 });
    assert.equal(r.sources.RECO.impressions, 1);
    assert.equal(r.sources.RECO.clicks, 1);
    assert.equal(r.sources.FEED.impressions, 1);
  });
});
