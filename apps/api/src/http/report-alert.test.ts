import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportKind } from './support/report-kind.ts';

test('reconhece as rotas de denúncia e ignora o resto', () => {
  assert.equal(reportKind('POST', '/posts/abc/report'), 'post');
  assert.equal(reportKind('POST', '/posts/abc/comments/def/report'), 'comentário');
  assert.equal(reportKind('POST', '/conversations/abc/report'), 'conversa');
  assert.equal(reportKind('POST', '/feed/posts/abc/report'), 'publicação do feed');
  assert.equal(reportKind('POST', '/api/feed/comments/abc/report'), 'comentário do feed');
  assert.equal(reportKind('POST', '/events/abc/stories/def/report'), 'story de evento');
  assert.equal(reportKind('POST', '/profiles/ana/report?x=1'), 'perfil');
  assert.equal(reportKind('GET', '/posts/abc/report'), undefined);
  assert.equal(reportKind('POST', '/posts/abc/like'), undefined);
});
