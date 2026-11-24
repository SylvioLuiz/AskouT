import assert from 'node:assert/strict';
import { DomainError } from '../errors.ts';
import type { ErrorCode } from '../errors.ts';
import type { HomeFeedItem, PostView } from '../post-service.ts';

/** Afirma que a promessa falha com um DomainError do código esperado. `label` diz qual caso falhou. */
export async function rejectsWith(promise: Promise<unknown>, code: ErrorCode, label?: string): Promise<DomainError> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  const where = label ? `${label}: ` : '';
  assert.ok(caught instanceof DomainError, `${where}esperava DomainError ${code}, mas ${caught ? String(caught) : 'não falhou'}`);
  assert.equal(caught.code, code, `${where}código esperado ${code}, recebido ${caught.code} (${caught.message})`);
  return caught;
}

/** Itens do Início que devem ser todos posts (sem evento de local repostado); falha se vier outro tipo. */
export function postsOnly(items: HomeFeedItem[]): PostView[] {
  return items.map((item, i) => {
    assert.ok(!('type' in item), `item ${i} do Início é um evento de local, esperava um post`);
    return item as PostView;
  });
}
