import { conflict } from '../../core/errors.ts';
import type { EmailSender } from '../../core/ports.ts';
import { block, renderEmail, renderText, type LayoutBrand } from './email-layout.ts';

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
  /** Endereço do site (PUBLIC_WEB_URL), usado no logo, nos links e na assinatura. Padrão: https://askout.com.br. */
  siteUrl?: string;
  /** Logo do topo dos e-mails (padrão: `${siteUrl}/email/logo.png`, servido pelo site). */
  logoUrl?: string;
  fetch?: MailFetch;
}

interface Message {
  subject: string;
  text: string;
  html: string;
}

function codeMessage(brand: LayoutBrand, input: { title: string; intro: string; code: string; expiresInMinutes: number; footer: string }): Message {
  const minutes = `${input.expiresInMinutes} ${input.expiresInMinutes === 1 ? 'minuto' : 'minutos'}`;
  const subject = `${input.code} é o seu código do AskouT`;
  const validity = `O código vale por ${minutes}.`;
  return {
    subject,
    text: renderText(brand, [input.intro, input.code, validity], input.footer),
    html: renderEmail(brand, {
      subject,
      preheader: `${input.intro} ${validity}`,
      body: [block.title(input.title), block.paragraph(input.intro), block.code(input.code), block.note(validity)].join('\n'),
      footer: input.footer,
    }),
  };
}

function noticeMessage(brand: LayoutBrand, input: { subject: string; title: string; paragraphs: string[]; action?: { label: string; href: string }; footer: string }): Message {
  const actionText = input.action ? [`${input.action.label}: ${input.action.href}`] : [];
  return {
    subject: input.subject,
    text: renderText(brand, [input.title, ...input.paragraphs, ...actionText], input.footer),
    html: renderEmail(brand, {
      subject: input.subject,
      preheader: input.paragraphs[0] ?? input.title,
      body: [block.title(input.title), ...input.paragraphs.map(block.paragraph), ...(input.action ? [block.button(input.action.label, input.action.href)] : [])].join('\n'),
      footer: input.footer,
    }),
  };
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
  private readonly brand: LayoutBrand;

  constructor(options: ResendOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.replyTo = options.replyTo;
    this.contact = options.contactEmail ?? options.replyTo ?? 'privacidade@askout.com.br';
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.brand = { siteUrl: (options.siteUrl ?? 'https://askout.com.br').replace(/\/+$/, ''), ...(options.logoUrl ? { logoUrl: options.logoUrl } : {}) };
  }

  sendSignupCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    return this.deliver(
      input.to,
      codeMessage(this.brand, {
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
      codeMessage(this.brand, {
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
      noticeMessage(this.brand, {
        subject: 'Bem-vindo ao AskouT',
        title: `Bem-vindo ao AskouT, @${input.username}!`,
        paragraphs: [
          'Sua conta está pronta. Siga seus amigos, marque nos dias em que você pode sair e combine encontros de verdade.',
          'Você controla quem vê o quê em Privacidade, dentro do app, e pode baixar seus dados ou apagar a conta quando quiser.',
        ],
        action: { label: 'Abrir o AskouT', href: this.brand.siteUrl },
        footer: `Se você não criou esta conta, escreva para ${this.contact}.`,
      }),
    );
  }

  sendAccountDeleted(input: { to: string; username: string }): Promise<void> {
    return this.deliver(
      input.to,
      noticeMessage(this.brand, {
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
      noticeMessage(this.brand, {
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
