import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AVATAR_ZOOM_MAX, clampView, initialAvatarView, panView, viewToCrop, zoomView } from './avatar-crop.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const FRAME = 300;

describe('recorte da foto de perfil', () => {
  it('começa com o maior quadrado possível, no meio', () => {
    const r = viewToCrop(initialAvatarView(), FRAME, 1600, 1200);
    close(r.h, 1);
    close(r.w * 1600, 1200);
    close(r.x, (1 - r.w) / 2);
    close(r.y, 0);
  });
  it('não deixa a foto sair do círculo ao arrastar', () => {
    const v = panView(initialAvatarView(), 10_000, 10_000, FRAME, 1600, 1200);
    close(v.y, 0);
    const r = viewToCrop(v, FRAME, 1600, 1200);
    close(r.x, 0);
    const back = viewToCrop(panView(initialAvatarView(), -10_000, 0, FRAME, 1600, 1200), FRAME, 1600, 1200);
    close(back.x + back.w, 1);
  });
  it('zoom fica entre 1 e o máximo', () => {
    assert.equal(clampView({ zoom: 0.2, x: 0, y: 0 }, FRAME, 800, 800).zoom, 1);
    assert.equal(clampView({ zoom: 99, x: 0, y: 0 }, FRAME, 800, 800).zoom, AVATAR_ZOOM_MAX);
  });
  it('zoom mantém parado o ponto sob os dedos', () => {
    const before = initialAvatarView();
    const after = zoomView(before, 2, FRAME, 1000, 1000, 60, -30);
    // O ponto da foto que estava em (60, -30) continua ali: (p - x) / zoom não muda.
    close((60 - after.x) / after.zoom, (60 - before.x) / before.zoom);
    close((-30 - after.y) / after.zoom, (-30 - before.y) / before.zoom);
    const r = viewToCrop(after, FRAME, 1000, 1000);
    close(r.w, 0.5);
    assert.ok(r.x >= 0 && r.x + r.w <= 1 + 1e-9 && r.y >= 0 && r.y + r.h <= 1 + 1e-9);
  });
  it('voltar o zoom para 1 recentraliza a foto quadrada', () => {
    const zoomed = panView(zoomView(initialAvatarView(), 3, FRAME, 900, 900), 80, 40, FRAME, 900, 900);
    const out = zoomView(zoomed, 1, FRAME, 900, 900);
    assert.deepEqual(out, { zoom: 1, x: 0, y: 0 });
  });
});
