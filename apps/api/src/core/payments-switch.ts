import { notFound } from './errors.ts';
import type { CoreDeps } from './ports.ts';

/** Chave guardada no banco. Só a gestão (painel) altera. */
export const PAYMENTS_SETTING_KEY = 'payments.enabled';

export interface PaymentsState {
  /** O que vale agora: ligado só se a gestão quer E existe provedor configurado. */
  enabled: boolean;
  /** O que a gestão escolheu pelo painel; `null` se ainda não escolheu (vale o valor inicial da configuração). */
  chosen: boolean | null;
  /** Valor inicial vindo da configuração do servidor (`PAYMENTS_ENABLED`), usado enquanto a gestão não escolher. */
  initial: boolean;
  provider: 'sandbox' | 'stripe' | 'none';
  /** Dá para ligar? Só com um provedor configurado no servidor. */
  canEnable: boolean;
  blocker: string | null;
  /** Compra dentro do app (App Store/Google Play): só existe quando há verificador de recibos. */
  storeAvailable: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Chave geral do pagamento do impulsionamento. Vale na hora, em qualquer servidor, porque é lida do banco a cada pedido.
 * Sem provedor configurado ela nunca fica ligada, mesmo que alguém tenha escolhido ligar antes.
 */
export class PaymentsSwitch {
  private readonly deps: CoreDeps;
  private readonly initial: boolean;

  constructor(deps: CoreDeps, initial: boolean) {
    this.deps = deps;
    this.initial = initial;
  }

  private async chosen(): Promise<boolean | null> {
    const row = await this.deps.settings.get(PAYMENTS_SETTING_KEY);
    return row === undefined ? null : row.value === 'true';
  }

  async isEnabled(): Promise<boolean> {
    if (this.deps.payments.provider === 'none') return false;
    return (await this.chosen()) ?? this.initial;
  }

  async state(): Promise<PaymentsState> {
    const row = await this.deps.settings.get(PAYMENTS_SETTING_KEY);
    const provider = this.deps.payments.provider;
    const chosen = row === undefined ? null : row.value === 'true';
    let updatedBy: string | null = null;
    if (row?.updatedBy) updatedBy = (await this.deps.users.findProfileById(row.updatedBy))?.username ?? null;
    return {
      enabled: provider !== 'none' && (chosen ?? this.initial),
      chosen,
      initial: this.initial,
      provider,
      canEnable: provider !== 'none',
      blocker: provider === 'none' ? 'Nenhum provedor de pagamento está configurado no servidor (PAYMENT_PROVIDER).' : null,
      storeAvailable: this.deps.storeVerifier !== undefined,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy,
    };
  }

  async set(enabled: boolean, adminId: string): Promise<void> {
    if (typeof enabled !== 'boolean') throw notFound();
    await this.deps.settings.set({ key: PAYMENTS_SETTING_KEY, value: enabled ? 'true' : 'false', updatedAt: this.deps.clock.now(), updatedBy: adminId });
  }
}
