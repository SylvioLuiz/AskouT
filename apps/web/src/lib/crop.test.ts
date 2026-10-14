import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changeMode, CROP_MIN, cropToPixels, feedRatio, fitRatio, initialCrop, moveCrop, resizeCrop } from './crop.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const pxRatio = (r: { w: number; h: number }, w: number, h: number) => (r.w * w) / (r.h * h);

describe('recorte', () => {
  it('formato fixo: o maior possível, no meio, na proporção certa', () => {
    const sq = initialCrop(1600, 1200, 'square');
    close(pxRatio(sq, 1600, 1200), 1);
    close(sq.h, 1);
    close(sq.x, (1 - sq.w) / 2);
    const por = initialCrop(1600, 1200, 'portrait');
    close(pxRatio(por, 1600, 1200), 0.8);
    const land = initialCrop(1000, 2000, 'landscape');
    close(pxRatio(land, 1000, 2000), 1.91);
    assert.ok(land.w <= 1 && land.h <= 1);
  });
  it('livre começa com a imagem toda', () => {
    assert.deepEqual(initialCrop(800, 600, 'free'), { x: 0, y: 0, w: 1, h: 1 });
  });
  it('trocar de formato mantém o centro; livre mantém o recorte', () => {
    const r = { x: 0.6, y: 0.1, w: 0.3, h: 0.4 };
    assert.deepEqual(changeMode(r, 1000, 1000, 'free'), r);
    const sq = changeMode(r, 1000, 1000, 'square');
    close(pxRatio(sq, 1000, 1000), 1);
    assert.ok(sq.x >= 0 && sq.x + sq.w <= 1 + 1e-9 && sq.y >= 0 && sq.y + sq.h <= 1 + 1e-9);
  });
  it('arrastar não sai da imagem', () => {
    const r = moveCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 5, -5);
    assert.deepEqual(r, { x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });
  it('livre: o canto acompanha o dedo, o oposto fica parado, e há tamanho mínimo', () => {
    const r = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'se', 0.9, 0.6, 1000, 1000, null);
    close(r.x, 0.2);
    close(r.y, 0.2);
    close(r.w, 0.7);
    close(r.h, 0.4);
    const tiny = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'se', 0.2, 0.2, 1000, 1000, null);
    close(tiny.w, CROP_MIN);
    close(tiny.h, CROP_MIN);
    const out = resizeCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'nw', -3, -3, 1000, 1000, null);
    close(out.x, 0);
    close(out.y, 0);
    close(out.x + out.w, 0.7);
  });
  it('formato fixo: puxar um canto mantém a proporção e o canto oposto', () => {
    const start = fitRatio(1600, 1200, 0.8);
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const r = resizeCrop({ x: 0.3, y: 0.25, w: 0.2, h: 0.2 * (1600 / 1200) / 0.8 }, corner, 0.5, 0.5, 1600, 1200, 0.8);
      close(pxRatio(r, 1600, 1200), 0.8, 1e-6);
      assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, corner);
    }
    assert.ok(start.w > 0);
    const big = resizeCrop({ x: 0.3, y: 0.25, w: 0.2, h: 0.2 * (1600 / 1200) / 0.8 }, 'se', 5, 5, 1600, 1200, 0.8);
    assert.ok(big.x + big.w <= 1 + 1e-9 && big.y + big.h <= 1 + 1e-9);
    close(pxRatio(big, 1600, 1200), 0.8, 1e-6);
  });
  it('pixels da região', () => {
    assert.deepEqual(cropToPixels({ x: 0.25, y: 0, w: 0.5, h: 1 }, 1600, 1200), { sx: 400, sy: 0, sw: 800, sh: 1200 });
    const edge = cropToPixels({ x: 0.9999, y: 0.9999, w: 0.5, h: 0.5 }, 100, 100);
    assert.ok(edge.sx + edge.sw <= 100 && edge.sy + edge.sh <= 100 && edge.sw >= 1);
  });
  it('proporção do feed fica entre 4:5 e 1,91:1', () => {
    close(feedRatio(1000, 2000), 0.8);
    close(feedRatio(4000, 1000), 1.91);
    close(feedRatio(1000, 1000), 1);
    close(feedRatio(0, 0), 0.8);
  });
});
