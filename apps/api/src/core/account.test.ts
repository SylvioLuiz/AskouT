import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PASSWORD, makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

async function setup() {
  const w = makeWorld();
  const { ana, bia } = await w.signUpMany('ana', 'bia');
  await w.follows.save({ followerId: ana!, followeeId: bia!, status: 'ACCEPTED', createdAt: w.clock.now() });
  await w.follows.save({ followerId: bia!, followeeId: ana!, status: 'ACCEPTED', createdAt: w.clock.now() });
  return { w, ana: ana!, bia: bia! };
}

describe('conta: exportar e apagar', () => {
  it('exporta os dados da própria pessoa em um arquivo com nome claro', async () => {
    const { w, ana } = await setup();
    const file = await w.core.account.exportData(ana);
    assert.match(file.filename, /^askout-meus-dados-ana-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal((file.data['profile'] as { username: string }).username, 'ana');
    assert.equal(typeof file.data['generatedAt'], 'string');
    const text = JSON.stringify(file.data);
    assert.ok(!text.includes('passwordHash'), 'nunca exporta o hash da senha');
  });

  it('exige digitar o @usuário certo (com ou sem @, sem diferenciar maiúsculas) e a senha', async () => {
    const { w, ana } = await setup();
    await rejectsWith(w.core.account.deleteAccount(ana, { password: PASSWORD }), 'VALIDATION');
    await rejectsWith(w.core.account.deleteAccount(ana, { username: 'bia', password: PASSWORD }), 'VALIDATION');
    await rejectsWith(w.core.account.deleteAccount(ana, { username: 'ana' }), 'VALIDATION');
    await rejectsWith(w.core.account.deleteAccount(ana, { username: 'ana', password: 'senha-errada-123' }), 'VALIDATION');
    assert.deepEqual(w.account.deleted, [], 'nada foi apagado');
    assert.deepEqual(await w.core.account.deleteAccount(ana, { username: ' @ANA ', password: PASSWORD }), { deleted: true });
    assert.deepEqual(w.account.deleted.length, 1);
  });

  it('depois de apagar, a sessão antiga para de valer e os vínculos somem', async () => {
    const { w, ana } = await setup();
    const session = await w.core.auth.login({ identifier: 'ana', password: PASSWORD });
    await w.core.account.deleteAccount(ana, { username: 'ana', password: PASSWORD });
    await rejectsWith(w.core.auth.authenticate(session.token), 'UNAUTHORIZED');
    await rejectsWith(w.core.auth.login({ identifier: 'ana', password: PASSWORD }), 'UNAUTHORIZED');
    assert.equal(w.follows.rows.size, 0, 'seguidores nos dois sentidos sumiram');
    // O e-mail e o @usuário ficam livres: dá para criar a conta de novo.
    await w.signUp('ana');
  });

  it('conta que entra com Google/Apple confirma só digitando o @usuário', async () => {
    const { w, ana } = await setup();
    w.identities.rows.set('GOOGLE|sub-1', ana);
    assert.deepEqual(await w.core.account.deleteAccount(ana, { username: 'ana' }), { deleted: true });
  });

  it('não apaga quem tem impulsionamento pago em andamento, nem conta de administração', async () => {
    const { w, ana } = await setup();
    w.account.activeBoosts.set(ana, 1);
    await rejectsWith(w.core.account.deleteAccount(ana, { username: 'ana', password: PASSWORD }), 'CONFLICT');
    w.account.activeBoosts.clear();
    const user = w.users.users.get(ana)!;
    w.users.users.set(ana, { ...user, role: 'ADMIN' });
    await rejectsWith(w.core.account.deleteAccount(ana, { username: 'ana', password: PASSWORD }), 'FORBIDDEN');
    assert.deepEqual(w.account.deleted, []);
  });
});
