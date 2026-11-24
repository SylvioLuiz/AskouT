import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rejectsWith } from './testing/helpers.ts';
import { makeWorld, PASSWORD, asSession } from './testing/world.ts';
import { totpCode, totpStep } from './totp.ts';

const H = 3_600_000;
const JPEG = (n = 10) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]).toString('base64')}`;

async function setup() {
  const w = makeWorld();
  const u = await w.signUpMany('adm', 'ana', 'bia', 'dono');
  const adm = u['adm']!, ana = u['ana']!, bia = u['bia']!, dono = u['dono']!;
  w.users.users.set(adm, { ...w.users.users.get(adm)!, role: 'ADMIN' });
  const A = { userId: adm, role: 'ADMIN' as const };
  await w.places.createVenue({ id: 'v1', name: 'Bar do Zé', address: 'Rua A, 1', category: 'bar', lat: -23.58, lng: -46.65, isSample: false, ownerId: dono });
  return { w, A, adm, ana, bia, dono };
}

test('auditoria: entrada no painel e troca da própria senha ficam registradas', async () => {
  const { w, A, adm } = await setup();
  await asSession(w.core.admin.login({ identifier: 'adm', password: PASSWORD }));
  await w.core.admin.changeOwnPassword(A, { currentPassword: PASSWORD, newPassword: 'outra-senha-boa-123' });
  const rows = (await w.core.admin.audit(A, {})).items;
  assert.deepEqual(rows.map((r) => r.action), ['ADMIN_PASSWORD_CHANGED', 'ADMIN_LOGIN']);
  assert.deepEqual([rows[1]!.adminId, rows[1]!.targetId, rows[1]!.targetLabel, rows[1]!.actorKind], [adm, adm, '@adm', 'ADMIN']);
  assert.match(rows[1]!.note ?? '', /senha/);
  // Senha errada não registra nada.
  await rejectsWith(w.core.admin.login({ identifier: 'adm', password: 'errada-errada-1' }), 'UNAUTHORIZED');
  assert.equal((await w.core.admin.audit(A, {})).total, 2);
});

test('auditoria: suspender e editar perfil guardam o nome do alvo e o antes/depois campo a campo', async () => {
  const { w, A, ana } = await setup();
  await w.core.admin.setUserStatus(A, ana, 'SUSPENDED', 'Spam');
  await w.core.admin.setUserStatus(A, ana, 'ACTIVE', null);
  await w.core.admin.editUser(A, ana, { displayName: 'Ana Nova', bio: 'Oi, tudo bem?', note: 'Pedido dela' });
  const [edit, reactivated, suspended] = (await w.core.admin.audit(A, {})).items;
  assert.deepEqual([suspended!.action, suspended!.targetLabel, suspended!.changes], ['USER_SUSPENDED', '@ana', [{ field: 'situação', before: 'ativa', after: 'suspensa' }]]);
  assert.equal(reactivated!.changes?.[0]?.after, 'ativa');
  assert.equal(edit!.action, 'USER_PROFILE_EDITED');
  assert.deepEqual(edit!.changes?.map((c) => [c.field, c.after]), [['nome', 'Ana Nova'], ['biografia', 'Oi, tudo bem?']]);
});

test('auditoria: apagar post guarda autor e trecho, que continuam legíveis depois', async () => {
  const { w, A, ana } = await setup();
  const post = await w.core.posts.create(ana, { placeName: 'Bar do Zé', images: [JPEG()], caption: 'Foto do rolê de ontem no Bar do Zé' });
  await w.core.admin.deletePost(A, post.id, 'Conteúdo impróprio');
  const row = (await w.core.admin.audit(A, { action: 'POST_REMOVED' })).items[0]!;
  assert.match(row.targetLabel ?? '', /^@ana: “Foto do rolê/);
  assert.equal(row.changes?.find((c) => c.field === 'autor')?.before, '@ana');
});

test('auditoria: ações sensíveis de quem usa o app (exportar dados, apagar conta) entram como USER', async () => {
  const { w, A, bia } = await setup();
  await w.core.account.exportData(bia);
  await w.core.account.deleteAccount(bia, { username: 'bia', password: PASSWORD });
  const rows = (await w.core.admin.audit(A, { actorKind: 'USER' })).items;
  assert.deepEqual(rows.map((r) => r.action), ['ACCOUNT_DELETED', 'ACCOUNT_DATA_EXPORTED']);
  assert.deepEqual([rows[0]!.adminId, rows[0]!.targetLabel, rows[0]!.actorKind], [bia, '@bia', 'USER']);
});

test('auditoria: impulsionamento pedido pelo dono e pagamento confirmado pelo sistema', async () => {
  const { w, A, dono } = await setup();
  const b = await w.core.boosts.create(dono, 'v1', { target: 'VENUE', days: 7 });
  await w.core.boosts.simulatePayment(dono, b.id);
  const rows = (await w.core.admin.audit(A, { targetType: 'BOOST' })).items;
  assert.deepEqual(rows.map((r) => [r.action, r.actorKind]), [['BOOST_PAID', 'SYSTEM'], ['BOOST_ORDERED', 'USER']]);
  assert.deepEqual([rows[0]!.adminId, rows[0]!.adminUsername, rows[0]!.targetLabel], [null, 'sistema', 'Bar do Zé']);
  assert.match(rows[1]!.note ?? '', /7 dia\(s\), R\$ /);
});

test('auditoria: verificação em duas etapas de conta da gestão fica registrada; de conta comum, não', async () => {
  const { w, A, adm, ana } = await setup();
  for (const id of [adm, ana]) {
    const started = await w.core.auth.mfa.setup(id);
    w.clock.tick(30_000);
    await w.core.auth.mfa.enable(id, totpCode(started.secret, totpStep(w.clock.now())));
  }
  const rows = (await w.core.admin.audit(A, { action: 'MFA_ENABLED' })).items;
  assert.deepEqual(rows.map((r) => r.targetId), [adm]);
});

test('auditoria: filtros por texto, alvo, quem fez, tipo e período; filtro inválido é recusado', async () => {
  const { w, A, adm, ana, bia } = await setup();
  await w.core.admin.setUserStatus(A, ana, 'SUSPENDED', 'Spam repetido');
  w.clock.tick(48 * H);
  await w.core.admin.setUserStatus(A, bia, 'SUSPENDED', 'Golpe');
  const all = await w.core.admin.audit(A, {});
  assert.equal(all.total, 2);
  assert.deepEqual((await w.core.admin.audit(A, { q: 'golpe' })).items.map((r) => r.targetId), [bia]);
  assert.deepEqual((await w.core.admin.audit(A, { q: '@ana' })).items.map((r) => r.targetId), [ana], 'acha pelo nome do alvo');
  assert.deepEqual((await w.core.admin.audit(A, { q: 'ana' })).items.map((r) => r.targetId), [ana]);
  assert.equal((await w.core.admin.audit(A, { q: 'adm' })).total, 2, 'acha pelo @ de quem fez');
  assert.deepEqual((await w.core.admin.audit(A, { targetId: ana })).items.map((r) => r.action), ['USER_SUSPENDED']);
  assert.equal((await w.core.admin.audit(A, { actorId: adm })).total, 2);
  assert.equal((await w.core.admin.audit(A, { actorKind: 'SYSTEM' })).total, 0);
  assert.equal((await w.core.admin.audit(A, { targetType: 'USER', action: 'USER_SUSPENDED' })).total, 2);
  const today = w.clock.now().toISOString().slice(0, 10);
  const r = await w.core.admin.audit(A, { from: today, to: today });
  assert.ok(r.items.every((i) => i.targetId === bia) && r.total >= 1);
  await rejectsWith(w.core.admin.audit(A, { actorKind: 'ROBO' }), 'VALIDATION');
  await rejectsWith(w.core.admin.audit(A, { from: '24/11/2026' }), 'VALIDATION');
  await rejectsWith(w.core.admin.audit(A, { targetType: 'NAVE' }), 'VALIDATION');
});
