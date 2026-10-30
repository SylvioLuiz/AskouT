import { conflict } from '../../core/errors.ts';
import type { EmailSender } from '../../core/ports.ts';

const API = 'https://api.resend.com/emails';

export interface MailFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number }>;
}

export interface ResendOptions {
  /** Chave da API do Resend (re_…). Nunca vai para o navegador nem para o log. */
  apiKey: string;
  /** Remetente, com o domínio já verificado no Resend. Ex.: `AskouT <nao-responda@seudominio.com.br>`. */
  from: string;
  /** Para onde vão as respostas das pessoas (opcional). */
  replyTo?: string;
  /** Endereço de contato que aparece nos avisos (padrão: o de resposta, se houver). */
  contactEmail?: string;
  fetch?: MailFetch;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Message {
  subject: string;
  text: string;
  html: string;
}

function codeMessage(input: { title: string; intro: string; code: string; expiresInMinutes: number; footer: string }): Message {
  const minutes = `${input.expiresInMinutes} ${input.expiresInMinutes === 1 ? 'minuto' : 'minutos'}`;
  const text = `${input.intro}\n\n${input.code}\n\nO código vale por ${minutes}.\n\n${input.footer}\n\nAskouT`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1e">
<div style="max-width:420px;margin:0 auto;padding:28px;background:#ffffff;border-radius:16px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700">${escapeHtml(input.title)}</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5">${escapeHtml(input.intro)}</p>
<p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:6px;text-align:center">${escapeHtml(input.code)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5c5c60">O código vale por ${minutes}.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#5c5c60">${escapeHtml(input.footer)}</p>
</div></body></html>`;
  return { subject: `${input.code} é o seu código do AskouT`, text, html };
}

function noticeMessage(input: { subject: string; title: string; paragraphs: string[]; footer: string }): Message {
  const text = `${input.title}\n\n${input.paragraphs.join('\n\n')}\n\n${input.footer}\n\nAskouT`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c1e">
<div style="max-width:420px;margin:0 auto;padding:28px;background:#ffffff;border-radius:16px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700">${escapeHtml(input.title)}</p>
${input.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#5c5c60">${escapeHtml(input.footer)}</p>
</div></body></html>`;
  return { subject: input.subject, text, html };
}

/**
 * Envio real de e-mail pelo Resend (API HTTP, sem biblioteca). Só entram o código e o endereço de quem pediu;
 * nenhum dos dois é registrado no log. Escrito conforme a documentação do Resend, mas ainda NÃO exercitado contra a conta real (ver GOLIVE.md).
 */
export class ResendEmailSender implements EmailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly replyTo: string | undefined;
  private readonly contact: string;
  private readonly fetchImpl: MailFetch;

  constructor(options: ResendOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.replyTo = options.replyTo;
    this.contact = options.contactEmail ?? options.replyTo ?? 'privacidade@askout.com.br';
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  sendSignupCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    return this.deliver(
      input.to,
      codeMessage({
        title: 'Confirme seu e-mail',
        intro: 'Use este código para terminar de criar sua conta no AskouT.',
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
        footer: 'Se não foi você, ignore este e-mail: nada acontece sem o código.',
      }),
    );
  }

  sendPasswordResetCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    return this.deliver(
      input.to,
      codeMessage({
        title: 'Criar uma nova senha',
        intro: 'Use este código para criar uma nova senha no AskouT.',
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
        footer: 'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
      }),
    );
  }

  sendWelcome(input: { to: string; username: string }): Promise<void> {
    return this.deliver(
      input.to,
      noticeMessage({
        subject: 'Bem-vindo ao AskouT',
        title: `Bem-vindo ao AskouT, @${input.username}!`,
        paragraphs: [
          'Sua conta está pronta. Siga seus amigos, marque nos dias em que você pode sair e combine encontros de verdade.',
          'Você controla quem vê o quê em Privacidade, dentro do app, e pode baixar seus dados ou apagar a conta quando quiser.',
        ],
        footer: `Se você não criou esta conta, escreva para ${this.contact}.`,
      }),
    );
  }

  sendAccountDeleted(input: { to: string; username: string }): Promise<void> {
    return this.deliver(
      input.to,
      noticeMessage({
        subject: 'Sua conta do AskouT foi apagada',
        title: 'Sua conta foi apagada',
        paragraphs: [
          `A conta @${input.username} e os dados ligados a ela foram apagados do AskouT, como você pediu. Isso não pode ser desfeito.`,
          'Você pode criar uma conta nova quando quiser, com este mesmo e-mail.',
        ],
        footer: `Se você não pediu isso, escreva agora para ${this.contact}.`,
      }),
    );
  }

  /** Aviso interno para a equipe quando alguém denuncia algo (sem dados de quem denunciou). */
  sendModerationAlert(input: { to: string; what: string; reason: string | undefined }): Promise<void> {
    return this.deliver(
      input.to,
      noticeMessage({
        subject: `Nova denúncia no AskouT: ${input.what}`,
        title: 'Nova denúncia para revisar',
        paragraphs: [
          `Chegou uma denúncia de ${input.what}${input.reason ? ` (motivo: ${input.reason})` : ''}.`,
          'Abra o painel admin, julgue o conteúdo, remova o que for ofensivo, retire o usuário se necessário e feche a denúncia. O prazo é de 24 horas.',
        ],
        footer: 'Aviso automático do AskouT.',
      }),
    );
  }

  private async deliver(to: string, message: Message): Promise<void> {
    let res;
    try {
      res = await this.fetchImpl(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [to], subject: message.subject, text: message.text, html: message.html, ...(this.replyTo ? { reply_to: this.replyTo } : {}) }),
      });
    } catch {
      throw conflict('Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
    }
    if (!res.ok) throw conflict('Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
  }
}
