import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeFilename, usernameMatches } from './account.ts';

describe('conta', () => {
  it('confere o @usuário digitado', () => {
    assert.equal(usernameMatches('ana', 'ana'), true);
    assert.equal(usernameMatches('  @ANA ', 'ana'), true);
    assert.equal(usernameMatches('an', 'ana'), false);
    assert.equal(usernameMatches('', 'ana'), false);
    assert.equal(usernameMatches('@', 'ana'), false);
  });

  it('nome de arquivo seguro', () => {
    assert.equal(safeFilename('askout-meus-dados-ana-2026-10-22.json'), 'askout-meus-dados-ana-2026-10-22.json');
    assert.equal(safeFilename('../../etc/passwd'), 'etc-passwd.json');
    assert.equal(safeFilename(''), 'askout-meus-dados.json');
    assert.equal(safeFilename('a b/c.json'), 'a-b-c.json');
  });
});
