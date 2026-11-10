import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PASSWORD, makeWorld } from './testing/world.ts';
import { rejectsWith } from './testing/helpers.ts';

describe('consentimentos opcionais (LGPD)', () => {
  it('começam todos desligados e mostram o aceite dos Termos do cadastro', async () => {
    const w = makeWorld();
    const { ana } = await w.signUpMany('ana');
    const status = await w.core.consents.status(ana!);
    assert.deepEqual(
      status.consents.map((c) => [c.purpose, c.granted, c.updatedAt]),
      [
        ['MARKETING_EMAIL', false, null],
        ['MARKETING_PUSH', false, null],
      ],
    );
    assert.equal(status.terms.acceptedVersion, status.terms.currentVersion);
    assert.equal(typeof status.terms.acceptedAt, 'string');
    assert.deepEqual(status.history, []);
  });

  it('liga e desliga guardando o histórico, mais recente primeiro; repetir o mesmo valor não cria registro', async () => {
    const w = makeWorld();
    const { ana } = await w.signUpMany('ana');
    await w.core.consents.set(ana!, { purpose: 'MARKETING_PUSH', granted: true });
    w.clock.tick(1000);
    await w.core.consents.set(ana!, { purpose: 'MARKETING_PUSH', granted: true });
    const off = await w.core.consents.set(ana!, { purpose: 'MARKETING_PUSH', granted: false });
    assert.equal(off.consents.find((c) => c.purpose === 'MARKETING_PUSH')!.granted, false);
    assert.deepEqual(
      off.history.map((h) => [h.purpose, h.granted, h.source]),
      [
        ['MARKETING_PUSH', false, 'SETTINGS'],
        ['MARKETING_PUSH', true, 'SETTINGS'],
      ],
    );
    assert.equal(await w.core.consents.isGranted(ana!, 'MARKETING_PUSH'), false);
  });

  it('recusa finalidade desconhecida ou valor que não é booleano', async () => {
    const w = makeWorld();
    const { ana } = await w.signUpMany('ana');
    await rejectsWith(w.core.consents.set(ana!, { purpose: 'VENDER_DADOS', granted: true }), 'VALIDATION');
    await rejectsWith(w.core.consents.set(ana!, { purpose: 'MARKETING_EMAIL', granted: 'sim' }), 'VALIDATION');
  });

  it('o "sim" opcional do cadastro vira registro com origem SIGNUP; sem marcar, fica desligado', async () => {
    const w = makeWorld();
    await w.core.auth.startSignup({ email: 'cau@exemplo.com', username: 'cau', password: PASSWORD, birthDate: '1990-01-01', acceptTerms: true, marketingEmail: true });
    const cau = await w.core.auth.confirmSignup({ email: 'cau@exemplo.com', code: w.mailer.lastCodeFor('cau@exemplo.com') });
    const status = await w.core.consents.status(cau.user.id);
    assert.equal(status.consents.find((c) => c.purpose === 'MARKETING_EMAIL')!.granted, true);
    assert.deepEqual(status.history.map((h) => h.source), ['SIGNUP']);

    const { ana } = await w.signUpMany('ana');
    assert.equal(await w.core.consents.isGranted(ana!, 'MARKETING_EMAIL'), false);
  });

  it('entra na cópia dos dados e some ao apagar a conta', async () => {
    const w = makeWorld();
    const { ana, bia } = await w.signUpMany('ana', 'bia');
    await w.core.consents.set(ana!, { purpose: 'MARKETING_EMAIL', granted: true });
    await w.core.consents.set(bia!, { purpose: 'MARKETING_EMAIL', granted: true });
    const file = await w.core.account.exportData(ana!);
    assert.deepEqual((file.data['consents'] as { purpose: string }[]).map((c) => c.purpose), ['MARKETING_EMAIL']);
    await w.core.account.deleteAccount(ana!, { username: 'ana', password: PASSWORD });
    assert.deepEqual(w.consents.rows.map((r) => r.userId), [bia]);
  });
});
