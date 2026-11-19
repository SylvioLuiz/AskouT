import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCALE_MAX, STORY_OVERLAYS_MAX, cleanOverlays, containRect, inkOn, nextStyle, normalizeAngle, overTrash, overlayLook, overlaysHeader, pinch } from './story-overlays.ts';
import type { StoryOverlay } from './types.ts';

const text: StoryOverlay = { kind: 'TEXT', text: 'Partiu!', x: 0.5, y: 0.5, scale: 1, rotation: 0, color: '#ffffff', style: 'CLASSIC' };

describe('textos do flash: geometria', () => {
  it('encaixa a mídia inteira no palco (como object-fit: contain)', () => {
    assert.deepEqual(containRect({ width: 390, height: 844 }, { width: 1080, height: 1920 }), { left: 0, top: 75.33333333333331, width: 390, height: 693.3333333333334 });
    const wide = containRect({ width: 400, height: 800 }, { width: 1600, height: 900 });
    assert.equal(wide.width, 400);
    assert.equal(wide.height, 225);
    assert.equal(wide.top, 287.5);
    assert.deepEqual(containRect({ width: 300, height: 600 }, { width: 0, height: 0 }), { left: 0, top: 0, width: 300, height: 600 });
  });

  it('pinça: afastar os dedos aumenta, girar gira', () => {
    const r = pinch([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 200 }], { scale: 1, rotation: 10 });
    assert.equal(r.scale, 2);
    assert.equal(Math.round(r.rotation), 100);
    assert.equal(pinch([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { scale: 1, rotation: 0 }).scale, SCALE_MAX);
  });

  it('ângulo fica entre -180 e 180', () => {
    assert.equal(normalizeAngle(270), -90);
    assert.equal(normalizeAngle(-190), 170);
    assert.equal(normalizeAngle(180), 180);
  });

  it('lixeira: só conta dentro do círculo', () => {
    assert.ok(overTrash({ x: 100, y: 700 }, { x: 110, y: 710, radius: 40 }));
    assert.ok(!overTrash({ x: 100, y: 600 }, { x: 110, y: 710, radius: 40 }));
  });
});

describe('textos do flash: envio', () => {
  it('tira itens vazios, corta excesso e limita a posição', () => {
    const out = cleanOverlays([{ ...text, text: '  ' }, { ...text, x: 2, y: -1, rotation: 400, text: ' oi\r\n ' }]);
    assert.deepEqual(out, [{ ...text, text: 'oi', x: 1, y: 0, rotation: 40 }]);
    assert.equal(cleanOverlays(Array.from({ length: 20 }, () => text)).length, STORY_OVERLAYS_MAX);
  });

  it('cabeçalho em base64 guarda emoji e acento', () => {
    assert.equal(overlaysHeader([]), undefined);
    const header = overlaysHeader([{ ...text, kind: 'STICKER', text: '🎉 Ação' }])!;
    assert.equal(JSON.parse(Buffer.from(header, 'base64').toString('utf8'))[0].text, '🎉 Ação');
  });
});

describe('textos do flash: aparência', () => {
  it('estilos se alternam em ciclo', () => {
    assert.equal(nextStyle('CLASSIC'), 'BOX');
    assert.equal(nextStyle('SERIF'), 'CLASSIC');
  });

  it('no estilo caixa, a letra contrasta com o fundo', () => {
    assert.equal(inkOn('#ffffff'), '#111111');
    assert.equal(inkOn('#111111'), '#ffffff');
    const look = overlayLook({ ...text, style: 'BOX', color: '#ffd60a' }, 400);
    assert.equal(look.backgroundColor, '#ffd60a');
    assert.equal(look.color, '#111111');
  });

  it('o tamanho acompanha a largura da mídia e a escala', () => {
    assert.equal(overlayLook({ ...text, scale: 2 }, 400).fontSize, '60.00px');
    assert.equal(overlayLook({ ...text, kind: 'STICKER' }, 400).fontSize, '64.00px');
    // Por maior que fique, a linha quebra dentro da mídia.
    assert.equal(overlayLook({ ...text, scale: 4 }, 400).maxWidth, '360.00px');
  });
});
