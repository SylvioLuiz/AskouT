import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { supportMailto } from './help-mailto.ts';

describe('suporte por e-mail', () => {
  it('monta o mailto com o usuário', () => {
    const link = supportMailto('ajuda@exemplo.com', 'ana');
    assert.ok(link?.startsWith('mailto:ajuda@exemplo.com?subject='));
    assert.ok(decodeURIComponent(link ?? '').includes('@ana'));
  });
  it('sem endereço válido não mostra', () => {
    assert.equal(supportMailto(undefined, 'ana'), undefined);
    assert.equal(supportMailto('  ', 'ana'), undefined);
    assert.equal(supportMailto('nao-e-email', 'ana'), undefined);
  });
});
