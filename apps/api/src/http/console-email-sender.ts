import type { EmailSender } from '../core/ports.ts';

/**
 * SOMENTE DESENVOLVIMENTO: imprime o código de cadastro no terminal em vez de enviar e-mail.
 * A configuração recusa este envio em produção. Falta implementar um provedor real.
 */
export class ConsoleEmailSender implements EmailSender {
  async sendPasswordResetCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    console.log(`[DEV e-mail] código para nova senha de ${input.to}: ${input.code} (vale ${input.expiresInMinutes} min)`);
  }

  async sendSignupCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    console.log(`[DEV e-mail] código de cadastro para ${input.to}: ${input.code} (vale ${input.expiresInMinutes} min)`);
  }
}
