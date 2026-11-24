import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canEditImage, contrastInk, cropLayers, editedName, editedType, farEnough, fitSize, isWholeImage, rotateLayers, rotatePoint, textLines, TEXT_SIZE_MAX } from './image-edit.ts';
import type { EditLayers } from './image-edit.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

describe('editar foto do chat', () => {
  it('reduz a foto grande sem aumentar a pequena', () => {
    assert.deepEqual(fitSize(4000, 3000, 2000), { width: 2000, height: 1500 });
    assert.deepEqual(fitSize(800, 600, 2000), { width: 800, height: 600 });
  });

  it('girar 90° leva o canto de cima à esquerda para o de cima à direita', () => {
    assert.deepEqual(rotatePoint({ x: 0, y: 0 }), { x: 1, y: 0 });
    assert.deepEqual(rotatePoint({ x: 1, y: 0 }), { x: 1, y: 1 });
    // Quatro giros voltam ao começo.
    let p = { x: 0.2, y: 0.7 };
    for (let i = 0; i < 4; i += 1) p = rotatePoint(p);
    close(p.x, 0.2);
    close(p.y, 0.7);
  });

  it('desenho e texto acompanham o giro', () => {
    const layers: EditLayers = {
      strokes: [{ color: '#fff', size: 0.01, points: [{ x: 0.1, y: 0.2 }] }],
      texts: [{ id: 'a', text: 'oi', color: '#fff', boxed: false, x: 0.25, y: 0.5, size: 0.08 }],
    };
    const r = rotateLayers(layers);
    assert.deepEqual(r.strokes[0]?.points[0], { x: 0.8, y: 0.1 });
    assert.equal(r.texts[0]?.x, 0.5);
    assert.equal(r.texts[0]?.y, 0.25);
    assert.equal(r.texts[0]?.size, 0.08);
  });

  it('recorte reposiciona e aumenta desenho e texto na mesma proporção', () => {
    const layers: EditLayers = {
      strokes: [{ color: '#fff', size: 0.01, points: [{ x: 0.5, y: 0.5 }] }],
      texts: [{ id: 'a', text: 'oi', color: '#fff', boxed: false, x: 0.5, y: 0.5, size: 0.05 }],
    };
    // Metade do meio de uma foto 1000×1000: tudo fica duas vezes maior.
    const c = cropLayers(layers, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1000, 1000);
    assert.deepEqual(c.strokes[0]?.points[0], { x: 0.5, y: 0.5 });
    close(c.strokes[0]?.size ?? 0, 0.02);
    close(c.texts[0]?.size ?? 0, 0.1);
  });

  it('texto que ficaria fora do recorte volta para a borda e não passa do tamanho máximo', () => {
    const layers: EditLayers = { strokes: [], texts: [{ id: 'a', text: 'oi', color: '#fff', boxed: false, x: 0.05, y: 0.95, size: 0.15 }] };
    const c = cropLayers(layers, { x: 0.4, y: 0.1, w: 0.2, h: 0.2 }, 1000, 1000);
    assert.equal(c.texts[0]?.x, 0);
    assert.equal(c.texts[0]?.y, 1);
    assert.equal(c.texts[0]?.size, TEXT_SIZE_MAX);
  });

  it('reconhece o recorte da foto inteira', () => {
    assert.equal(isWholeImage({ x: 0, y: 0, w: 1, h: 1 }), true);
    assert.equal(isWholeImage({ x: 0.1, y: 0, w: 0.9, h: 1 }), false);
  });

  it('letra preta em caixa clara e branca em caixa escura', () => {
    assert.equal(contrastInk('#ffffff'), '#111111');
    assert.equal(contrastInk('#ffd60a'), '#111111');
    assert.equal(contrastInk('#111111'), '#ffffff');
    assert.equal(contrastInk('#5856d6'), '#ffffff');
  });

  it('separa as linhas do texto', () => {
    assert.deepEqual(textLines('  oi\ntudo bem?\n'), ['oi', 'tudo bem?']);
  });

  it('ignora pontos do pincel muito próximos', () => {
    assert.equal(farEnough(undefined, { x: 0, y: 0 }, 0.01), true);
    assert.equal(farEnough({ x: 0, y: 0 }, { x: 0.001, y: 0 }, 0.01), false);
    assert.equal(farEnough({ x: 0, y: 0 }, { x: 0.02, y: 0 }, 0.01), true);
  });

  it('nome e formato da foto editada', () => {
    assert.equal(editedType('image/png'), 'image/png');
    assert.equal(editedType('image/heic'), 'image/jpeg');
    assert.equal(editedName('IMG_001.HEIC', 'image/jpeg'), 'IMG_001-editada.jpg');
    assert.equal(editedName('print.png', 'image/png'), 'print-editada.png');
  });

  it('GIF e vídeo não abrem o editor', () => {
    assert.equal(canEditImage('image/jpeg'), true);
    assert.equal(canEditImage('image/gif'), false);
    assert.equal(canEditImage('video/mp4'), false);
  });
});
