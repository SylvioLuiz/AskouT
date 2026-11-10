import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOOST_TRACK_BATCH_MAX, BoostStatQueue } from './boost-stats.ts';

describe('relatório do anúncio (web)', () => {
  it('manda cada cartão uma vez por aba, mesmo aparecendo de novo', () => {
    const q = new BoostStatQueue();
    q.add({ kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1' });
    q.add({ kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1' });
    q.add({ kind: 'OPEN', placement: 'EXPLORE', eventId: 'e1' });
    assert.deepEqual(q.drain().map((e) => e.kind), ['IMPRESSION', 'OPEN']);
    q.add({ kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1' });
    assert.equal(q.size, 0, 'já foi mandado');
    q.add({ kind: 'IMPRESSION', placement: 'HOME', eventId: 'e1' });
    assert.equal(q.size, 1, 'outro lugar do app vai (o servidor conta a pessoa uma vez só)');
    q.reset();
    q.add({ kind: 'IMPRESSION', placement: 'EXPLORE', eventId: 'e1' });
    assert.equal(q.size, 1, 'depois de esquecer, manda de novo');
  });
  it('ignora registro sem evento e sem local, e respeita o tamanho do lote', () => {
    const q = new BoostStatQueue();
    q.add({ kind: 'IMPRESSION', placement: 'HOME' });
    assert.equal(q.size, 0);
    for (let i = 0; i < BOOST_TRACK_BATCH_MAX + 5; i += 1) q.add({ kind: 'IMPRESSION', placement: 'EXPLORE', venueId: `v${i}` });
    assert.equal(q.drain().length, BOOST_TRACK_BATCH_MAX);
    assert.equal(q.size, 5);
  });
});
