import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dataUrlBytes, fitWithin, safeGroupImage } from './image.ts';

describe('image', () => {
  it('reduz mantendo a proporção e não amplia', () => {
    assert.deepEqual(fitWithin(1024, 512, 256), { width: 256, height: 128 });
    assert.deepEqual(fitWithin(100, 50, 256), { width: 100, height: 50 });
    assert.deepEqual(fitWithin(0, 10, 256), { width: 1, height: 1 });
  });
  it('conta bytes do base64', () => {
    assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
    assert.equal(dataUrlBytes('data:image/png;base64,AA=='), 1);
  });
  it('só aceita data URL de imagem', () => {
    assert.equal(safeGroupImage('data:image/jpeg;base64,/9j/4A=='), 'data:image/jpeg;base64,/9j/4A==');
    assert.equal(safeGroupImage('https://x/y.png'), null);
    assert.equal(safeGroupImage('data:text/html;base64,AAAA'), null);
    assert.equal(safeGroupImage(null), null);
  });
});
