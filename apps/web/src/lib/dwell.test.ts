import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DWELL_BATCH_MAX, DwellQueue, readPersonalize, savePersonalize, VisibleTimer } from './dwell.ts';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe('medição de permanência (web)', () => {
  it('soma o tempo do mesmo conteúdo e separa por origem', () => {
    const q = new DwellQueue();
    q.add({ targetType: 'POST', targetId: 'a', ms: 2000, source: 'FEED' });
    q.add({ targetType: 'POST', targetId: 'a', ms: 1500, source: 'FEED' });
    q.add({ targetType: 'POST', targetId: 'a', ms: 700, source: 'RECO' });
    assert.equal(q.size, 2);
    assert.deepEqual(q.drain().map((e) => [e.source, e.ms]), [['FEED', 3500], ['RECO', 700]]);
    assert.equal(q.size, 0);
  });
  it('descarta o que somou menos que o mínimo e entradas inválidas', () => {
    const q = new DwellQueue();
    q.add({ targetType: 'POST', targetId: 'curto', ms: 300, source: 'FEED' });
    q.add({ targetType: 'POST', targetId: '', ms: 9000, source: 'FEED' });
    q.add({ targetType: 'POST', targetId: 'x', ms: Number.NaN, source: 'FEED' });
    q.add({ targetType: 'POST', targetId: 'x', ms: -5, source: 'FEED' });
    assert.deepEqual(q.drain(), []);
  });
  it('entrega em lotes do tamanho do servidor', () => {
    const q = new DwellQueue();
    for (let i = 0; i < DWELL_BATCH_MAX + 5; i += 1) q.add({ targetType: 'EVENT', targetId: `e${i}`, ms: 2000, source: 'FEED' });
    assert.equal(q.drain().length, DWELL_BATCH_MAX);
    assert.equal(q.drain().length, 5);
  });
  it('cronômetro de visibilidade', () => {
    const t = new VisibleTimer();
    assert.equal(t.stop(1000), 0);
    t.start(1000);
    t.start(5000);
    assert.equal(t.running, true);
    assert.equal(t.stop(4000), 3000);
    assert.equal(t.running, false);
  });
  it('personalização liga por padrão, desliga e volta', () => {
    const s = memory();
    assert.equal(readPersonalize('u1', s), true);
    savePersonalize('u1', false, s);
    assert.equal(readPersonalize('u1', s), false);
    assert.equal(readPersonalize('u2', s), true);
    savePersonalize('u1', true, s);
    assert.equal(readPersonalize('u1', s), true);
    assert.equal(s.data.size, 0);
  });
  it('sem armazenamento, continua ligado sem quebrar', () => {
    const broken = { getItem: () => { throw new Error('bloqueado'); } };
    assert.equal(readPersonalize('u1', broken), true);
    assert.doesNotThrow(() => savePersonalize('u1', false, { setItem: () => { throw new Error('x'); }, removeItem: () => undefined }));
  });
});
