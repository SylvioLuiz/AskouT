import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TwilioSmsSender, smsText } from './twilio-sms-sender.ts';

const SID = `AC${'a'.repeat(32)}`;

test('twilio: manda o código para o número com autenticação básica e remetente', async () => {
  const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
  const sender = new TwilioSmsSender({ accountSid: SID, authToken: 'b'.repeat(32), from: '+15551234567', fetch: async (url, init) => (calls.push({ url, init }), { ok: true, status: 201 }) });
  await sender.sendCode({ to: '+5511987654321', code: '123456', purpose: 'LOGIN', expiresInMinutes: 10 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
  assert.equal(calls[0]!.init.headers['Authorization'], `Basic ${Buffer.from(`${SID}:${'b'.repeat(32)}`).toString('base64')}`);
  const form = new URLSearchParams(calls[0]!.init.body);
  assert.equal(form.get('To'), '+5511987654321');
  assert.equal(form.get('From'), '+15551234567');
  assert.match(form.get('Body')!, /^123456 é o seu código para entrar no AskouT/);
});

test('twilio: Messaging Service tem preferência e erro HTTP vira falha', async () => {
  let body = '';
  const sender = new TwilioSmsSender({ accountSid: SID, authToken: 'b'.repeat(32), from: '+15551234567', messagingServiceSid: `MG${'c'.repeat(32)}`, fetch: async (_url, init) => ((body = init.body), { ok: false, status: 400 }) });
  await assert.rejects(sender.sendCode({ to: '+5511987654321', code: '123456', purpose: 'VERIFY', expiresInMinutes: 10 }), /HTTP 400/);
  const form = new URLSearchParams(body);
  assert.equal(form.get('MessagingServiceSid'), `MG${'c'.repeat(32)}`);
  assert.equal(form.get('From'), null);
  assert.match(smsText({ code: '1', purpose: 'VERIFY', expiresInMinutes: 10 }), /confirmar seu celular/);
});
