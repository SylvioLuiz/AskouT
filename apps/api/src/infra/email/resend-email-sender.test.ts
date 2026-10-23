import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ResendEmailSender, type MailFetch } from './resend-email-sender.ts';

function make(fetch: MailFetch, replyTo?: string) {
  return new ResendEmailSender({ apiKey: 're_teste', from: 'AskouT <nao-responda@exemplo.com.br>', ...(replyTo ? { replyTo } : {}), fetch });
}

describe('ResendEmailSender', () => {
  it('envia o código de cadastro com remetente, destinatário e texto em português', async () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    await make(async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
      return { ok: true, status: 200 };
    }).sendSignupCode({ to: 'ana@exemplo.com', code: '048213', expiresInMinutes: 10 });
    const call = calls[0]!;
    assert.equal(call.url, 'https://api.resend.com/emails');
    assert.equal(call.headers['Authorization'], 'Bearer re_teste');
    assert.equal(call.body['from'], 'AskouT <nao-responda@exemplo.com.br>');
    assert.deepEqual(call.body['to'], ['ana@exemplo.com']);
    assert.equal(call.body['subject'], '048213 é o seu código do AskouT');
    assert.match(String(call.body['text']), /048213/);
    assert.match(String(call.body['text']), /10 minutos/);
    assert.match(String(call.body['html']), /Confirme seu e-mail/);
    assert.equal('reply_to' in call.body, false);
  });

  it('o e-mail de nova senha tem texto próprio e aceita responder-para', async () => {
    let body: Record<string, unknown> = {};
    await make(async (_u, init) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200 };
    }, 'ajuda@exemplo.com.br').sendPasswordResetCode({ to: 'ana@exemplo.com', code: '123456', expiresInMinutes: 1 });
    assert.match(String(body['text']), /nova senha/);
    assert.match(String(body['text']), /1 minuto\./);
    assert.equal(body['reply_to'], 'ajuda@exemplo.com.br');
  });

  it('boas-vindas e conta apagada: textos próprios, com contato para quem não reconhece', async () => {
    const bodies: Record<string, unknown>[] = [];
    const sender = make(async (_u, init) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return { ok: true, status: 200 };
    }, 'ajuda@exemplo.com.br');
    await sender.sendWelcome({ to: 'ana@exemplo.com', username: 'ana' });
    await sender.sendAccountDeleted({ to: 'ana@exemplo.com', username: 'ana' });
    assert.equal(bodies[0]!['subject'], 'Bem-vindo ao AskouT');
    assert.match(String(bodies[0]!['text']), /@ana/);
    assert.match(String(bodies[0]!['text']), /ajuda@exemplo.com.br/);
    assert.equal(bodies[1]!['subject'], 'Sua conta do AskouT foi apagada');
    assert.match(String(bodies[1]!['text']), /não pode ser desfeito/);
    assert.match(String(bodies[1]!['html']), /ajuda@exemplo.com.br/);
    assert.deepEqual(bodies[1]!['to'], ['ana@exemplo.com']);
  });

  it('nome com caracteres especiais não quebra o HTML', async () => {
    let body: Record<string, unknown> = {};
    await make(async (_u, init) => { body = JSON.parse(init.body) as Record<string, unknown>; return { ok: true, status: 200 }; }).sendWelcome({ to: 'a@b.co', username: '<b>x</b>' });
    assert.doesNotMatch(String(body['html']), /<b>x<\/b>/);
  });

  it('falha com mensagem clara, sem expor o código nem a chave, quando o provedor recusa ou cai', async () => {
    for (const fetch of [async () => ({ ok: false, status: 422 }), async () => { throw new Error('rede com re_teste'); }] as MailFetch[]) {
      await assert.rejects(make(fetch).sendSignupCode({ to: 'ana@exemplo.com', code: '999999', expiresInMinutes: 10 }), (error: Error) => {
        assert.match(error.message, /Não foi possível enviar o e-mail/);
        assert.doesNotMatch(error.message, /999999|re_teste/);
        return true;
      });
    }
  });
});
