import type { SmsSender } from '../../core/ports.ts';

/** SOMENTE DESENVOLVIMENTO: imprime o código no terminal em vez de mandar SMS. A configuração recusa em produção. */
export class ConsoleSmsSender implements SmsSender {
  async sendCode(input: { to: string; code: string; purpose: 'LOGIN' | 'VERIFY'; expiresInMinutes: number }): Promise<void> {
    console.log(`[DEV SMS] código (${input.purpose}) para ${input.to}: ${input.code} (vale ${input.expiresInMinutes} min)`);
  }
}
