import assert from 'node:assert/strict';
import { DomainError } from '../errors.ts';
import type { ErrorCode } from '../errors.ts';

/** Afirma que a promessa falha com um DomainError do código esperado. */
export async function rejectsWith(promise: Promise<unknown>, code: ErrorCode): Promise<DomainError> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof DomainError, `esperava DomainError ${code}, mas ${caught ? String(caught) : 'não falhou'}`);
  assert.equal(caught.code, code, `código esperado ${code}, recebido ${caught.code} (${caught.message})`);
  return caught;
}
