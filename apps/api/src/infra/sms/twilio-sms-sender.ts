import type { SmsSender } from '../../core/ports.ts';

export interface SmsFetch {
  (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<{ ok: boolean; status: number }>;
}

export interface TwilioOptions {
  /** Account SID (AC…). */
  accountSid: string;
  /** Auth Token. Nunca vai para o navegador nem para o log. */
  authToken: string;
  /** Número remetente (E.164). Use este ou `messagingServiceSid`. */
  from?: string | undefined;
  /** Messaging Service (MG…), que escolhe o remetente sozinho. Tem preferência sobre `from`. */
  messagingServiceSid?: string | undefined;
  fetch?: SmsFetch;
}

/** Texto curto, sem link, com o código no começo (o iPhone e o Android sugerem preencher sozinhos). */
export function smsText(input: { code: string; purpose: 'LOGIN' | 'VERIFY'; expiresInMinutes: number }): string {
  const what = input.purpose === 'LOGIN' ? 'para entrar no AskouT' : 'para confirmar seu celular no AskouT';
  return `${input.code} é o seu código ${what}. Vale por ${input.expiresInMinutes} min. Não compartilhe com ninguém.`;
}

/**
 * Envio de SMS pelo Twilio (API REST, sem biblioteca). Escrito conforme a documentação do Twilio,
 * mas ainda NÃO exercitado contra uma conta real. Nem o número nem o código vão para o log.
 */
export class TwilioSmsSender implements SmsSender {
  private readonly options: TwilioOptions;
  private readonly fetchImpl: SmsFetch;

  constructor(options: TwilioOptions) {
    if (!options.from && !options.messagingServiceSid) throw new Error('Twilio: informe o número remetente ou o Messaging Service');
    this.options = options;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  }

  async sendCode(input: { to: string; code: string; purpose: 'LOGIN' | 'VERIFY'; expiresInMinutes: number }): Promise<void> {
    const { accountSid, authToken, from, messagingServiceSid } = this.options;
    const form = new URLSearchParams({ To: input.to, Body: smsText(input) });
    if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
    else form.set('From', from!);
    const response = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Twilio recusou o SMS (HTTP ${response.status})`);
  }
}
