import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortHour, applyToAll, daysSummary, draftFromProfile, hoursLines, openStatus, profileBody, profileProblem } from './venue-profile.ts';
import type { VenueHours, VenueProfile } from './types.ts';

// Dom null; Seg-Sáb 18:00 → 02:00 (passa da meia-noite)
const NIGHT: VenueHours = [null, ...Array.from({ length: 6 }, () => ({ open: '18:00', close: '02:00' }))];
// 2026-10-14 é quarta-feira
const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, 11 + day, hh, mm); // day 0 = domingo 11/10

test('sem horários informados não há estado', () => {
  assert.equal(openStatus(null, at(3, 20)), null);
  assert.equal(openStatus(Array.from({ length: 7 }, () => null), at(3, 20)), null);
});

test('aberto durante o expediente e mostra a hora de fechar', () => {
  assert.deepEqual(openStatus(NIGHT, at(3, 20)), { open: true, label: 'Aberto agora · fecha às 02:00', short: 'Aberto até 2h', closingSoon: false });
});

test('expediente que passa da meia-noite continua aberto na madrugada seguinte', () => {
  assert.equal(openStatus(NIGHT, at(4, 1, 30))?.open, true, 'quinta 01:30 ainda é o expediente de quarta');
  assert.equal(openStatus(NIGHT, at(0, 1, 0))?.open, true, 'domingo 01:00 é o expediente de sábado');
  assert.equal(openStatus(NIGHT, at(4, 2, 0))?.open, false, 'às 02:00 já fechou');
});

test('fechado: diz quando abre (hoje, amanhã ou o dia da semana)', () => {
  assert.equal(openStatus(NIGHT, at(3, 10))?.label, 'Fechado · abre hoje às 18:00');
  assert.equal(openStatus(NIGHT, at(6, 10))?.label, 'Fechado · abre hoje às 18:00');
  // sábado 03:00 (já fechou) → domingo fechado → abre segunda
  assert.equal(openStatus(NIGHT, at(0, 10))?.label, 'Fechado · abre amanhã às 18:00');
  const onlyFri: VenueHours = [null, null, null, null, null, { open: '19:00', close: '23:00' }, null];
  assert.equal(openStatus(onlyFri, at(3, 10))?.label, 'Fechado · abre sexta às 19:00');
  assert.equal(openStatus(onlyFri, at(5, 23, 30))?.label, 'Fechado · abre sexta às 19:00', 'só abre de novo na semana seguinte');
});

test('linhas da página: segunda a domingo, hoje marcado', () => {
  const lines = hoursLines(NIGHT, at(3, 12));
  assert.deepEqual(lines.map((l) => l.label), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  assert.equal(lines.find((l) => l.today)?.label, 'Qua');
  assert.equal(lines[0]!.text, '18:00 às 02:00');
  assert.equal(lines[6]!.text, 'Fechado');
  assert.deepEqual(hoursLines(null, at(3, 12)), []);
});

const PROFILE: VenueProfile = { id: 'v1', name: 'Bar do Zé', address: 'Rua A', category: 'bar', description: null, hours: NIGHT, coverUrl: '/venues/v1/cover?v=1', logoUrl: null, photoPath: null, photoAuthor: null, lat: 0, lng: 0, sample: false, claimed: true, isOwner: true, following: false, rating: { average: null, count: 0, mine: null }, followerCount: 0, upcomingEvents: [] };

test('rascunho do perfil: ida e volta e validações', () => {
  const d = draftFromProfile(PROFILE);
  assert.equal(d.days[0]!.open, false);
  assert.equal(d.days[1]!.from, '18:00');
  assert.equal(profileProblem(d), null);
  const body = profileBody(d);
  assert.deepEqual(body.hours, NIGHT);
  assert.equal(body.imageUrl, '/venues/v1/cover?v=1');
  assert.equal(body.logoUrl, null);
  assert.equal(profileBody({ ...d, logoData: 'data:image/png;base64,AA' }).logoData, 'data:image/png;base64,AA');
  assert.equal(body.description, null);
  assert.match(profileProblem({ ...d, name: ' A ' }) ?? '', /pelo menos/);
  assert.match(profileProblem({ ...d, description: 'x'.repeat(601) }) ?? '', /600/);
  const same = { ...d, days: d.days.map((x, i) => (i === 2 ? { open: true, from: '10:00', to: '10:00' } : x)) };
  assert.match(profileProblem(same) ?? '', /terça/);
  const allClosed = { ...d, days: d.days.map((x) => ({ ...x, open: false })) };
  assert.equal(profileBody(allClosed).hours, null);
  assert.equal(profileBody({ ...d, imageData: 'data:image/jpeg;base64,AA' }).imageData, 'data:image/jpeg;base64,AA');
  assert.equal('imageUrl' in profileBody({ ...d, imageData: 'data:image/jpeg;base64,AA' }), false);
});

test('aplicar a todos os dias', () => {
  const d = draftFromProfile(PROFILE);
  const all = applyToAll(d.days, 1);
  assert.equal(all.every((x) => x.open && x.from === '18:00' && x.to === '02:00'), true);
});

test('texto curto do horário: até quando, já vai fechar ou quando abre', () => {
  assert.equal(openStatus(NIGHT, at(3, 20))?.short, 'Aberto até 2h');
  assert.equal(openStatus(NIGHT, at(3, 20))?.closingSoon, false);
  const soon = openStatus(NIGHT, at(4, 1, 20));
  assert.equal(soon?.short, 'Fecha em 40 min');
  assert.equal(soon?.closingSoon, true);
  assert.equal(openStatus(NIGHT, at(3, 10))?.short, 'Abre às 18h');
  const lunch: VenueHours = Array.from({ length: 7 }, () => ({ open: '11:00', close: '15:00' }));
  assert.equal(openStatus(lunch, at(3, 16))?.short, 'Abre às 11h');
  assert.equal(openStatus(lunch, at(3, 14, 30))?.short, 'Fecha em 30 min');
});

test('resumo dos dias em que funciona', () => {
  assert.equal(daysSummary(null), null);
  assert.equal(daysSummary(Array.from({ length: 7 }, () => null)), null);
  assert.equal(daysSummary(NIGHT), 'Seg a Sáb');
  assert.equal(daysSummary(Array.from({ length: 7 }, () => ({ open: '10:00', close: '22:00' }))), 'Todos os dias');
  const d = (days: number[]): VenueHours => Array.from({ length: 7 }, (_, i) => (days.includes(i) ? { open: '18:00', close: '23:00' } : null));
  assert.equal(daysSummary(d([5, 6])), 'Sex e Sáb');
  assert.equal(daysSummary(d([1, 3, 5])), 'Seg, Qua e Sex');
  assert.equal(daysSummary(d([5, 6, 0])), 'Sex a Dom');
  assert.equal(daysSummary(d([2])), 'Ter');
  assert.equal(daysSummary(d([1, 2, 3, 5, 6])), 'Seg a Qua, Sex e Sáb');
});

test('hora redonda abreviada, com minutos fica como está; sem "hoje" nem "amanhã"', () => {
  assert.equal(shortHour('10:00'), '10h');
  assert.equal(shortHour('00:00'), '0h');
  assert.equal(shortHour('09:00'), '9h');
  assert.equal(shortHour('10:30'), '10:30');
  const half: VenueHours = Array.from({ length: 7 }, () => ({ open: '17:30', close: '23:45' }));
  assert.equal(openStatus(half, at(3, 10))?.short, 'Abre às 17:30');
  assert.equal(openStatus(half, at(3, 20))?.short, 'Aberto até 23:45');
  const onlyFri: VenueHours = [null, null, null, null, null, { open: '19:00', close: '23:00' }, null];
  assert.equal(openStatus(onlyFri, at(3, 10))?.short, 'Abre sexta às 19h', 'outros dias mantêm o nome do dia');
});
