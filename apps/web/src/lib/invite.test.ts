import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { APP_STORE_URL, PLAY_STORE_URL, inviteLandingTarget, playStoreUrl, invitePlatform, inviteUrl, parseInvite, rememberInvite, takeInvite, whatsappUrl } from './invite.ts';

describe('link do convite', () => {
  it('reconhece o celular pelo navegador', () => {
    assert.equal(invitePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios');
    assert.equal(invitePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios', 'iPad em modo computador');
    assert.equal(invitePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'other');
    assert.equal(invitePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
    assert.equal(invitePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'other');
  });
  it('no app abre o cadastro ou o perfil; no celular sem app, a loja; no computador, o cadastro', () => {
    const base = { username: 'ana.s', native: false, loggedIn: false };
    assert.deepEqual(inviteLandingTarget({ ...base, native: true, platform: 'ios' }), { kind: 'route', to: '/cadastro?convite=ana.s' });
    assert.deepEqual(inviteLandingTarget({ ...base, native: true, loggedIn: true, platform: 'android' }), { kind: 'route', to: '/u/ana.s' });
    assert.deepEqual(inviteLandingTarget({ ...base, platform: 'other' }), { kind: 'route', to: '/cadastro?convite=ana.s' });
    assert.deepEqual(inviteLandingTarget({ ...base, platform: 'ios' }), { kind: 'external', to: APP_STORE_URL });
    const android = inviteLandingTarget({ ...base, platform: 'android' });
    assert.equal(android.kind, 'external');
    assert.ok(android.to.startsWith('intent://convite/ana.s#Intent;scheme=br.com.askout;package=br.com.askout;'));
    assert.ok(android.to.includes(`S.browser_fallback_url=${encodeURIComponent(playStoreUrl('ana.s'))}`));
  });
});

describe('convite por link', () => {
  it('monta o link e o WhatsApp', () => {
    assert.equal(inviteUrl('https://askout.app', 'ana.s'), 'https://askout.app/convite/ana.s');
    const wa = whatsappUrl('Oi', 'https://x/y?a=1');
    assert.ok(wa.startsWith('https://wa.me/?text='));
    assert.equal(decodeURIComponent(wa.split('text=')[1] ?? ''), 'Oi https://x/y?a=1');
  });
  it('só aceita usuário no formato certo', () => {
    assert.equal(parseInvite('@Ana.S'), 'ana.s');
    assert.equal(parseInvite('ab'), undefined);
    assert.equal(parseInvite('a b c'), undefined);
    assert.equal(parseInvite('<script>'), undefined);
    assert.equal(parseInvite(null), undefined);
  });
  it('vale uma vez só', () => {
    const data = new Map<string, string>();
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    rememberInvite(s, 'ana');
    assert.equal(takeInvite(s), 'ana');
    assert.equal(takeInvite(s), undefined);
    assert.equal(takeInvite(undefined), undefined);
  });
});

test('link da Play Store leva o convite no referrer', () => {
  assert.equal(playStoreUrl('ana.s'), `${PLAY_STORE_URL}&referrer=convite%3Dana.s`);
});
