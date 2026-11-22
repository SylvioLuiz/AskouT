import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageFileName, saveImages } from './save-file.ts';

describe('baixar fotos', () => {
  it('nome do arquivo sem acento nem espaço, com a extensão do tipo', () => {
    assert.equal(imageFileName('askout-Samba no Bar do Zé-3', 'image/jpeg'), 'askout-samba-no-bar-do-ze-3.jpg');
    assert.equal(imageFileName('', 'image/png'), 'foto.png');
    assert.equal(imageFileName('x', 'application/octet-stream'), 'x.jpg');
  });
  it('no app usa a ponte nativa, sem repetir nomes', async () => {
    const got: string[] = [];
    const env = { AskouTFiles: { saveImages: async (o: { files: { filename: string }[] }) => void got.push(...o.files.map((f) => f.filename)) } };
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    assert.equal(await saveImages([{ blob, name: 'a' }, { blob, name: 'a' }], env as never), true);
    assert.deepEqual(got, ['a.jpg', 'a-2.jpg']);
  });
});
