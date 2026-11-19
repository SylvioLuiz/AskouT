import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMOJI_CATEGORIES, normalizeQuery, pushRecentEmoji, readRecentEmojis, searchEmojis } from './emoji-data.ts';
import { firstEmoji } from './chat-media.ts';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('emojis do seletor', () => {
  it('tem as oito categorias, cada uma com emojis válidos', () => {
    assert.deepEqual(EMOJI_CATEGORIES.map((c) => c.id), ['people', 'nature', 'food', 'activity', 'travel', 'objects', 'symbols', 'flags']);
    for (const category of EMOJI_CATEGORIES) {
      assert.ok(category.items.length > 10, category.id);
      for (const item of category.items) assert.equal(firstEmoji(item.emoji), item.emoji, `${category.id}: ${item.emoji}`);
    }
  });
  it('busca sem acento e pelo começo das palavras', () => {
    assert.equal(normalizeQuery('  Coração '), 'coracao');
    assert.ok(searchEmojis('coração').includes('❤️'));
    assert.ok(searchEmojis('cora verm').includes('❤️'));
    assert.ok(searchEmojis('cerv').includes('🍺'));
    assert.ok(searchEmojis('brasil').includes('🇧🇷'));
    assert.deepEqual(searchEmojis('   '), []);
    assert.deepEqual(searchEmojis('xyzxyz'), []);
  });
  it('não repete emoji que aparece em duas categorias', () => {
    const found = searchEmojis('fogos');
    assert.equal(new Set(found).size, found.length);
  });
  it('lembra os usados por último, sem repetir', () => {
    const storage = memoryStorage();
    assert.deepEqual(readRecentEmojis(storage), []);
    pushRecentEmoji(storage, '🔥');
    pushRecentEmoji(storage, '😂');
    assert.deepEqual(pushRecentEmoji(storage, '🔥'), ['🔥', '😂']);
    assert.deepEqual(readRecentEmojis(storage), ['🔥', '😂']);
    for (let i = 0; i < 40; i++) pushRecentEmoji(storage, String.fromCodePoint(0x1f600 + i));
    assert.equal(readRecentEmojis(storage).length, 24);
  });
  it('sem armazenamento ou com dado estragado, não quebra', () => {
    assert.deepEqual(readRecentEmojis(undefined), []);
    assert.deepEqual(pushRecentEmoji(undefined, '👍'), ['👍']);
    const storage = memoryStorage();
    storage.setItem('askout.emoji.recent', '{oops');
    assert.deepEqual(readRecentEmojis(storage), []);
  });
});
