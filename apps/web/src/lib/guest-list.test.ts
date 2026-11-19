import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guestListAction, guestListRules, parseGuestListForm } from './guest-list.ts';
import type { GuestListView } from './types.ts';

const base: GuestListView = { enabled: true, isOwner: false, config: { limit: 10, closesAt: null, maxCompanions: 2 }, count: 3, spotsLeft: 7, open: true, mine: null };

test('resumo das regras: vagas, acompanhantes e fechamento', () => {
  assert.equal(guestListRules(base.config!, 7, () => ''), '7 vagas · até 2 acompanhantes');
  assert.equal(guestListRules({ limit: 1, closesAt: '2026-01-01T02:00:00.000Z', maxCompanions: 1 }, 1, () => 'sex 23:00'), '1 vaga · até 1 acompanhante · fecha sex 23:00');
  assert.equal(guestListRules({ limit: 5, closesAt: null, maxCompanions: 0 }, 0, () => ''), 'Lista cheia');
  assert.equal(guestListRules({ limit: null, closesAt: null, maxCompanions: 0 }, null, () => ''), '');
});

test('ação principal de quem vê a lista', () => {
  assert.equal(guestListAction(base), 'join');
  assert.equal(guestListAction({ ...base, mine: { companions: 1, checkedIn: false } }), 'update');
  assert.equal(guestListAction({ ...base, open: false }), null);
  assert.equal(guestListAction({ ...base, enabled: false }), null);
  assert.equal(guestListAction({ ...base, open: false, mine: { companions: 0, checkedIn: false } }), null);
});

test('formulário do dono: limite, acompanhantes e horário', () => {
  const ok = parseGuestListForm({ limit: '50', maxCompanions: '2', closesAt: '2026-12-01T22:00' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual([ok.value.limit, ok.value.maxCompanions, typeof ok.value.closesAt], [50, 2, 'string']);
  const empty = parseGuestListForm({ limit: '', maxCompanions: '', closesAt: '' });
  assert.deepEqual(empty, { ok: true, value: { limit: null, maxCompanions: 0, closesAt: null } });
  const bad = parseGuestListForm({ limit: '0', maxCompanions: '9', closesAt: 'xx' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['closesAt', 'limit', 'maxCompanions']);
});
