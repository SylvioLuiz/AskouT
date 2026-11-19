import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appReturnUrl, backToAppPage } from './calendar-return-page.ts';

test('volta da agenda pelo app: abre o app na Agenda com o resultado', () => {
  assert.equal(appReturnUrl('GOOGLE', true, undefined), 'br.com.askout://agenda?agendas=google');
  assert.equal(appReturnUrl('MICROSOFT', false, 'Negado <x>'), 'br.com.askout://agenda?agendas=erro&motivo=Negado+%3Cx%3E');
  const page = backToAppPage(true, 'Google Agenda', undefined, appReturnUrl('GOOGLE', true, undefined));
  assert.match(page, /href="br\.com\.askout:\/\/agenda\?agendas=google"/);
  assert.match(page, /location\.href="br\.com\.askout:\/\/agenda\?agendas=google"/);
});
