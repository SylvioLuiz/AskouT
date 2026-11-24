import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventStatus, formatDate, formatDateTime, formatDuration, formatEventWhen, plural, query } from './labels.ts';

test('query: ignora vazios, codifica e junta', () => {
  assert.equal(query({}), '');
  assert.equal(query({ q: '', status: undefined, events: false }), '');
  assert.equal(query({ q: 'zé & cia', offset: 25, events: true }), '?q=z%C3%A9%20%26%20cia&offset=25&events=true');
});

test('datas: inválidas viram traço; válidas saem em pt-BR sem ponto final', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDateTime('lixo'), '—');
  assert.ok(!formatDate('2026-10-14T12:00:00.000Z').includes('.'));
  assert.match(formatDate('2026-10-14T12:00:00.000Z'), /^14\b.*\bout\b.*2026$/);
  assert.match(formatDateTime('2026-10-14T15:30:00.000Z'), /^14\b.*\bout\b.*2026.*12:30$/);
});

test('plural', () => {
  assert.equal(plural(1, 'pedido', 'pedidos'), '1 pedido');
  assert.equal(plural(0, 'pedido', 'pedidos'), '0 pedidos');
});

test('formatBirthDate: não troca o dia por causa do fuso', async () => {
  const { formatBirthDate } = await import('./labels.ts');
  assert.equal(formatBirthDate('1990-01-01'), '01/01/1990');
  assert.equal(formatBirthDate(null), '—');
  assert.equal(formatBirthDate('lixo'), '—');
});

test('eventos: quando, duração e situação', () => {
  assert.equal(formatEventWhen('2026-11-24T21:00:00-03:00', '2026-11-25T03:00:00-03:00'), 'ter, 24 de nov de 2026 · 21:00–03:00');
  assert.equal(formatEventWhen('2026-11-24T10:00:00-03:00', '2026-11-26T18:00:00-03:00'), 'ter, 24 de nov de 2026 · 10:00–26 de nov de 2026, 18:00');
  assert.equal(formatEventWhen('x', 'y'), '—');
  assert.equal(formatDuration('2026-11-24T21:00:00Z', '2026-11-25T03:00:00Z'), '6h');
  assert.equal(formatDuration('2026-11-24T21:00:00Z', '2026-11-24T22:30:00Z'), '1h30');
  assert.equal(formatDuration('2026-11-24T21:00:00Z', '2026-11-24T21:45:00Z'), '45min');
  const now = Date.parse('2026-11-24T22:00:00Z');
  assert.equal(eventStatus('2026-11-24T21:00:00Z', '2026-11-25T03:00:00Z', now), 'LIVE');
  assert.equal(eventStatus('2026-11-25T21:00:00Z', '2026-11-26T03:00:00Z', now), 'UPCOMING');
  assert.equal(eventStatus('2026-11-23T21:00:00Z', '2026-11-24T03:00:00Z', now), 'PAST');
});
