import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { edgeResist, stepIndex, swipeAxis, swipeStep, swipeThreshold } from './media-gallery.ts';

describe('visualizador de fotos do chat', () => {
  it('arrastar para a esquerda vai para a próxima e para a direita volta', () => {
    assert.equal(swipeStep(-80, 400), 1);
    assert.equal(swipeStep(80, 400), -1);
    assert.equal(swipeStep(-30, 400), 0);
  });

  it('em tela estreita, o arrasto mínimo acompanha a largura', () => {
    assert.equal(swipeThreshold(1000), 60);
    assert.equal(swipeThreshold(200), 36);
    assert.equal(swipeStep(-40, 200), 1);
  });

  it('decide o sentido do arrasto no primeiro movimento claro', () => {
    assert.equal(swipeAxis(3, 2), undefined);
    assert.equal(swipeAxis(20, 5), 'x');
    assert.equal(swipeAxis(4, -20), 'y');
  });

  it('não passa das pontas da lista', () => {
    assert.equal(stepIndex(0, -1, 3), undefined);
    assert.equal(stepIndex(0, 1, 3), 1);
    assert.equal(stepIndex(2, 1, 3), undefined);
  });

  it('na ponta o arrasto pesa', () => {
    assert.equal(edgeResist(90, true), 90);
    assert.equal(edgeResist(90, false), 30);
  });
});
