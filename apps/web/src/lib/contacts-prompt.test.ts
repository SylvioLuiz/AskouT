import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contactsConnected, markContactsConnected } from './contacts-prompt.ts';

describe('convite para conectar a agenda', () => {
  it('aparece até a agenda ser conferida', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    assert.equal(contactsConnected(s), false);
    markContactsConnected(s);
    assert.equal(contactsConnected(s), true);
  });
  it('sem armazenamento continua aparecendo e não quebra', () => {
    assert.equal(contactsConnected(undefined), false);
    markContactsConnected(undefined);
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    assert.equal(contactsConnected(broken), false);
    assert.doesNotThrow(() => markContactsConnected(broken));
  });
});
