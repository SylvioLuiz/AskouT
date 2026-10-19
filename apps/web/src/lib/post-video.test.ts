import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addImages, videoOf } from './post-draft.ts';
import type { DraftImage } from './post-draft.ts';
import { POST_VIDEO_MAX_BYTES, durationProblem, videoProblem } from './post-video.ts';

test('aceita MP4, WebM e MOV até 60 MB; recusa outros tipos, vazio e grande demais', () => {
  assert.equal(videoProblem({ type: 'video/mp4', size: 1000 }), undefined);
  assert.equal(videoProblem({ type: 'video/webm;codecs=vp9', size: 1000 }), undefined);
  assert.equal(videoProblem({ type: 'video/quicktime', size: POST_VIDEO_MAX_BYTES }), undefined);
  assert.match(videoProblem({ type: 'video/avi', size: 1000 }) ?? '', /MP4/);
  assert.match(videoProblem({ type: 'video/mp4', size: 0 }) ?? '', /vazio/);
  assert.match(videoProblem({ type: 'video/mp4', size: POST_VIDEO_MAX_BYTES + 1 }) ?? '', /60 MB/);
  assert.equal(POST_VIDEO_MAX_BYTES, 60 * 1024 * 1024);
});

test('duração: até 3 minutos; desconhecida não passa', () => {
  assert.equal(durationProblem(30), undefined);
  assert.equal(durationProblem(180), undefined);
  assert.match(durationProblem(181) ?? '', /3 minutos/);
  assert.match(durationProblem(Infinity) ?? '', /duração/);
  assert.match(durationProblem(0) ?? '', /duração/);
});

test('o rascunho acha o vídeo e a posição dele entre as fotos', () => {
  const photo = (key: string): DraftImage => ({ key, kind: 'UPLOAD', preview: 'p', dataUrl: 'd' });
  const file = { type: 'video/mp4', size: 10 } as File;
  const withVideo: DraftImage = { key: 'b', kind: 'UPLOAD', preview: 'p', dataUrl: 'd', video: file };
  const items = addImages([photo('a')], [withVideo, photo('c')]);
  assert.deepEqual(videoOf(items), { index: 1, file });
  assert.equal(videoOf([photo('a')]), undefined);
});
