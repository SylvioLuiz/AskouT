import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addImages, buildPostBody, effectivePlace, eventProblem, isoToLocalInput, localToIso } from './post-draft.ts';
import type { DraftImage } from './post-draft.ts';

const up = (n: number): DraftImage => ({ key: `u${n}`, kind: 'UPLOAD', preview: 'p', dataUrl: `data:image/jpeg;base64,${n}` });
const place = (n: number): DraftImage => ({ key: `p${n}`, kind: 'PLACE', preview: 'p', photoPath: `/places/photo?ref=${n}`, author: 'Maria', placeName: `Lugar ${n}`, placeAddress: 'Rua A' });

describe('rascunho do post', () => {
  it('limita a 5 fotos', () => {
    const six = [1, 2, 3, 4, 5, 6].map(up);
    assert.equal(addImages([], six).length, 5);
    assert.equal(addImages([up(1), up(2), up(3), up(4), up(5)], [up(6)]).length, 5);
  });
  it('só uma foto de lugar: a nova troca a anterior', () => {
    const r = addImages([up(1), place(1)], [place(2)]);
    assert.deepEqual(r.map((i) => i.key), ['u1', 'p2']);
  });
  it('foto de lugar com 5 fotos próprias: troca não estoura o limite', () => {
    const r = addImages([place(1), up(1), up(2), up(3), up(4)], [place(2)]);
    assert.equal(r.length, 5);
    assert.equal(r.filter((i) => i.kind === 'PLACE').length, 1);
  });
  it('o lugar vem da foto do lugar; senão do vínculo', () => {
    assert.deepEqual(effectivePlace([place(1)], { name: 'Outro', address: null }), { name: 'Lugar 1', address: 'Rua A' });
    assert.deepEqual(effectivePlace([up(1)], { name: 'Outro', address: null }), { name: 'Outro', address: null });
    assert.equal(effectivePlace([up(1)], null), null);
  });
  it('monta o corpo, sem campos vazios', () => {
    assert.deepEqual(buildPostBody([up(1)], '  ', null, []), { images: ['data:image/jpeg;base64,1'] });
    assert.deepEqual(buildPostBody([up(1), place(1)], ' oi ', null, ['a']), {
      images: ['data:image/jpeg;base64,1', { photoPath: '/places/photo?ref=1', photoAuthor: 'Maria' }],
      caption: 'oi',
      placeName: 'Lugar 1',
      placeAddress: 'Rua A',
      tagUserIds: ['a'],
    });
    assert.deepEqual(buildPostBody([up(1)], '', { name: 'Bar', address: null }, []), { images: ['data:image/jpeg;base64,1'], placeName: 'Bar' });
  });
});

it('evento: pede nome, lugar e início no futuro; corpo leva o evento em ISO', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const place = { name: 'Bar do Zé', address: null };
  const ok = { title: 'Pagode', startsAt: '2026-10-20T20:00', endsAt: '' };
  assert.equal(eventProblem(ok, place, now), null);
  assert.match(eventProblem({ ...ok, title: ' ' }, place, now) ?? '', /nome/);
  assert.equal(eventProblem(ok, null, now), null, 'o lugar é opcional');
  assert.match(eventProblem({ ...ok, startsAt: '2026-10-01T20:00' }, place, now) ?? '', /futuro/);
  assert.match(eventProblem({ ...ok, startsAt: '' }, place, now) ?? '', /início/);
  assert.match(eventProblem({ ...ok, endsAt: '2026-10-20T19:00' }, place, now) ?? '', /depois/);
  assert.equal(eventProblem({ ...ok, endsAt: '2026-10-23T12:00' }, place, now), null, 'mais de 24 h é permitido');
  assert.match(eventProblem({ ...ok, endsAt: '2026-11-25T12:00' }, place, now) ?? '', /30 dias/);
  assert.equal(localToIso('lixo'), null);
  const body = buildPostBody([], '', place, [], ok) as { event?: { title: string; startsAt: string } };
  assert.equal(body.event?.title, 'Pagode');
  assert.equal(body.event?.startsAt, new Date('2026-10-20T20:00').toISOString());
  assert.equal((buildPostBody([], '', place, []) as { event?: unknown }).event, undefined);
});

it('data/hora: ida e volta entre ISO e o campo do formulário', () => {
  assert.equal(isoToLocalInput(new Date('2026-10-20T20:05').toISOString()), '2026-10-20T20:05');
  assert.equal(localToIso(isoToLocalInput('2026-03-01T09:30:00.000Z')), new Date(new Date('2026-03-01T09:30:00.000Z').setSeconds(0, 0)).toISOString());
  assert.equal(isoToLocalInput('lixo'), '');
});

describe('evento privado', () => {
  it('só manda "private" quando marcado', () => {
    const base = { title: 'Festa', startsAt: '2026-11-05T20:00', endsAt: '' };
    const open = buildPostBody([], '', null, [], { ...base, private: false });
    const secret = buildPostBody([], '', null, [], { ...base, private: true });
    assert.equal('private' in (open.event ?? {}), false);
    assert.equal((secret.event as { private?: boolean }).private, true);
  });
});
