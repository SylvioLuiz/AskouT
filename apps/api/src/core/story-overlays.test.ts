import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STORY_OVERLAYS_MAX, parseStoryOverlays, parseStoryOverlaysHeader } from './story-overlays.ts';

const base = { kind: 'TEXT', text: 'Partiu!', x: 0.5, y: 0.4, scale: 1, rotation: 0, color: '#FFFFFF', style: 'BOX' };

describe('textos do story', () => {
  it('sem nada ou lista vazia: sem textos', () => {
    assert.equal(parseStoryOverlays(undefined), undefined);
    assert.equal(parseStoryOverlays([]), undefined);
    assert.equal(parseStoryOverlays([{ ...base, text: '   ' }]), undefined);
  });

  it('normaliza cor, posição, escala e giro', () => {
    const [o] = parseStoryOverlays([{ ...base, x: 1.4, y: -0.2, scale: 99, rotation: 270, color: '#FF0080' }])!;
    assert.deepEqual(o, { kind: 'TEXT', text: 'Partiu!', x: 1, y: 0, scale: 5, rotation: -90, color: '#ff0080', style: 'BOX' });
  });

  it('cor ou estilo desconhecidos viram o padrão', () => {
    const [o] = parseStoryOverlays([{ ...base, color: 'red', style: 'COMIC' }])!;
    assert.equal(o!.color, '#ffffff');
    assert.equal(o!.style, 'CLASSIC');
  });

  it('tira caracteres de controle mas mantém quebra de linha', () => {
    const [o] = parseStoryOverlays([{ ...base, text: 'Oi\u0007\r\ntodo mundo' }])!;
    assert.equal(o!.text, 'Oi\ntodo mundo');
  });

  it('recusa formato errado, texto longo e itens demais', () => {
    assert.throws(() => parseStoryOverlays({}), /inválidos/);
    assert.throws(() => parseStoryOverlays([{ ...base, x: 'meio' }]), /inválidos/);
    assert.throws(() => parseStoryOverlays([{ ...base, kind: 'GIF' }]), /inválidos/);
    assert.throws(() => parseStoryOverlays([{ ...base, text: 'a'.repeat(161) }]), /longo/);
    assert.throws(() => parseStoryOverlays(Array.from({ length: STORY_OVERLAYS_MAX + 1 }, () => base)), /demais/);
  });

  it('lê o cabeçalho em base64 com emoji e acento', () => {
    const header = Buffer.from(JSON.stringify([{ ...base, kind: 'STICKER', text: '🎉 Ação' }]), 'utf8').toString('base64');
    assert.equal(parseStoryOverlaysHeader(header)?.[0]?.text, '🎉 Ação');
    assert.equal(parseStoryOverlaysHeader(undefined), undefined);
    assert.equal(parseStoryOverlaysHeader(''), undefined);
    assert.throws(() => parseStoryOverlaysHeader('não é base64 {'), /inválidos/);
  });
});
