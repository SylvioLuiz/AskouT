import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findConflicts } from './going-conflict.ts';
import type { GoingEvent } from './types.ts';

const ev = (id: string, startsAt: string, endsAt: string): GoingEvent => ({ id, source: 'PLACE', title: id, startsAt, endsAt, venueName: null });

describe('conflito de horário ao dizer "Eu vou"', () => {
  const going = [
    ev('jantar', '2026-11-21T22:00:00Z', '2026-11-22T01:00:00Z'),
    ev('balada', '2026-11-22T02:00:00Z', '2026-11-22T08:00:00Z'),
    ev('dia-seguinte', '2026-11-23T20:00:00Z', '2026-11-23T23:00:00Z'),
  ];

  it('acha os eventos que se sobrepõem, em ordem de começo', () => {
    const target = { id: 'show', startsAt: '2026-11-22T00:00:00Z', endsAt: '2026-11-22T04:00:00Z' };
    assert.deepEqual(findConflicts(target, going).map((e) => e.id), ['jantar', 'balada']);
  });

  it('emendar um evento no outro não é conflito', () => {
    assert.deepEqual(findConflicts({ id: 'x', startsAt: '2026-11-22T01:00:00Z', endsAt: '2026-11-22T02:00:00Z' }, going), []);
    assert.deepEqual(findConflicts({ id: 'x', startsAt: '2026-11-22T08:00:00Z', endsAt: '2026-11-22T10:00:00Z' }, going), []);
  });

  it('o mesmo evento não conflita com ele mesmo', () => {
    assert.deepEqual(findConflicts({ id: 'jantar', startsAt: '2026-11-21T22:00:00Z', endsAt: '2026-11-22T01:00:00Z' }, going), []);
  });

  it('sem horário de fim, vale 3 horas; evento em outro dia não conflita', () => {
    assert.deepEqual(findConflicts({ id: 'x', startsAt: '2026-11-21T23:00:00Z' }, going).map((e) => e.id), ['jantar']);
    assert.deepEqual(findConflicts({ id: 'x', startsAt: '2026-11-24T20:00:00Z' }, going), []);
  });

  it('data inválida ou lista vazia não dá aviso', () => {
    assert.deepEqual(findConflicts({ id: 'x', startsAt: 'em breve' }, going), []);
    assert.deepEqual(findConflicts({ id: 'x', startsAt: '2026-11-22T00:00:00Z' }, []), []);
    assert.deepEqual(findConflicts({ id: 'x', startsAt: '2026-11-22T00:00:00Z' }, [ev('quebrado', 'hoje', 'amanhã')]), []);
  });
});
