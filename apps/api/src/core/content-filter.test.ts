import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasOffensiveText } from './content-filter.ts';
import { bioProblem, displayNameProblem, usernameProblem } from './validation.ts';

describe('Filtro de texto ofensivo', () => {
  it('barra termos inequívocos, mesmo disfarçados', () => {
    assert.equal(hasOffensiveText('Nazista', false), true);
    assert.equal(hasOffensiveText('n.a.z.i', false), true);
    assert.equal(hasOffensiveText('h1tl3r_oficial', false), true);
    assert.equal(hasOffensiveText('Que p0rra é essa', true), false); // "porra" não está na lista de propósito
    assert.equal(hasOffensiveText('vai tomar, FDP!', true), true);
    assert.equal(hasOffensiveText('puuuuta', true), true);
  });

  it('não barra nomes e palavras comuns (sem falso positivo)', () => {
    for (const ok of ['computador', 'Disputa', 'Cecília Sá', 'Scunthorpe', 'Putaendo', 'João da Silva', 'macacos-prego', 'Rafael Nazário']) {
      assert.equal(hasOffensiveText(ok, true), false, ok);
    }
    // palavras inteiras não valem em @usuário (sem espaços): "puta" dentro de "computador" etc.
    assert.equal(hasOffensiveText('computador.novo', false), false);
  });

  it('é aplicado a @usuário, nome e biografia', () => {
    assert.ok(usernameProblem('hitler.fan'));
    assert.equal(usernameProblem('maria.silva'), undefined);
    assert.ok(displayNameProblem('Caralho Alado'));
    assert.equal(displayNameProblem('Ana Paula'), undefined);
    assert.ok(bioProblem('Vagabunda mesmo'));
    assert.equal(bioProblem('Amo rolê e boteco'), undefined);
  });
});
