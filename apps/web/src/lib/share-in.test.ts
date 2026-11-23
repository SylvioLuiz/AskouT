import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSharedText, loadIncomingShare, shareInBridge, shareKind } from './share-in.ts';

test('shareKind: foto, vídeo, documento ou nada', () => {
  assert.equal(shareKind({ name: 'a.jpg', type: 'image/jpeg' }), 'IMAGE');
  assert.equal(shareKind({ name: 'a.mp4', type: 'video/mp4' }), 'VIDEO');
  assert.equal(shareKind({ name: 'Ingresso.pdf', type: 'application/octet-stream' }), 'FILE');
  assert.equal(shareKind({ name: 'a.apk', type: 'application/vnd.android.package-archive' }), undefined);
});

test('loadIncomingShare: lê os arquivos guardados pela casca (no máximo 10) e limpa o texto', async () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ path: `file:///c/${i}.pdf`, name: `${i}.pdf`, mime: 'application/pdf' }));
  const read: string[] = [];
  const share = await loadIncomingShare({ items, text: '  https://askout.com.br  ' }, async (p) => (read.push(p), new Blob(['%PDF-'])));
  assert.equal(share.files.length, 10);
  assert.equal(share.files[0]!.name, '0.pdf');
  assert.equal(share.text, 'https://askout.com.br');
  assert.equal(cleanSharedText(null), '');
});

test('shareInBridge: só com take e onShare', () => {
  assert.equal(shareInBridge({ AskouTShareIn: { take: async () => null } }), undefined);
  assert.ok(shareInBridge({ AskouTShareIn: { take: async () => null, onShare: () => () => undefined } }));
});
