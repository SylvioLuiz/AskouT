import { notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';

/** Chave guardada no banco. Só a gestão (painel) altera. */
export const PAYMENTS_SETTING_KEY = 'payments.enabled';
/** Pacotes de dias à venda (lista separada por vírgula, ex.: "1,3,7"). Sem valor gravado, todos os pacotes ficam à venda. */
export const BOOST_DAYS_SETTING_KEY = 'boost.days';
/** Todos os pacotes que existem (cada um é um produto askout.boost.<dias>d nas lojas). */
export const BOOST_ALL_DAY_OPTIONS: readonly number[] = [1, 3, 7, 14];

function parseDays(value: string | undefined): number[] | null {
  if (value === undefined) return null;
  const days = BOOST_ALL_DAY_OPTIONS.filter((d) => value.split(',').map((x) => x.trim()).includes(String(d)));
  return days.length > 0 ? days : null;
}

export interface PaymentsState {
  /** O que vale agora: ligado só se a gestão quer E existe um jeito de cobrar (provedor na web ou compra pelas lojas). */
  enabled: boolean;
  /** O que a gestão escolheu pelo painel; `null` se ainda não escolheu (vale o valor inicial da configuração). */
  chosen: boolean | null;
  /** Valor inicial vindo da configuração do servidor (`PAYMENTS_ENABLED`), usado enquanto a gestão não escolher. */
  initial: boolean;
  provider: 'sandbox' | 'stripe' | 'none';
  /** Dá para ligar? Só com provedor na web ou com compra pelas lojas configurada. */
  canEnable: boolean;
  blocker: string | null;
  /** Compra dentro do app (App Store/Google Play): só existe quando há verificador de recibos. */
  storeAvailable: boolean;
  /** Quais lojas têm conferente de recibos configurado no servidor. */
  stores: { apple: boolean; google: boolean };
  /** Pacotes de dias à venda agora (a gestão escolhe pelo painel). */
  offeredDays: number[];
  /** Todos os pacotes possíveis, com o produto que precisa existir nas lojas. */
  packages: { days: number; productId: string }[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Chave geral do pagamento do impulsionamento. Vale na hora, em qualquer servidor, porque é lida do banco a cada pedido.
 * Sem nenhum jeito de cobrar (nem provedor na web, nem loja) ela nunca fica ligada, mesmo que alguém tenha escolhido ligar antes.
 * Só com as lojas ela liga: o app vende pela App Store/Google Play e o site avisa que a compra é pelo app.
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

  /** Existe algum jeito de cobrar: provedor na web (Stripe/teste) ou compra pelas lojas com conferente de recibos. */
  private canCharge(): boolean {
    return this.deps.payments.provider !== 'none' || this.deps.storeVerifier !== undefined;
  }

  async isEnabled(): Promise<boolean> {
    if (!this.canCharge()) return false;
    return (await this.chosen()) ?? this.initial;
  }

  /** Pacotes à venda: o que a gestão escolheu, ou todos se ninguém escolheu. */
  async offeredDays(): Promise<number[]> {
    return parseDays((await this.deps.settings.get(BOOST_DAYS_SETTING_KEY))?.value) ?? [...BOOST_ALL_DAY_OPTIONS];
  }

  async setOfferedDays(days: unknown, adminId: string): Promise<number[]> {
    if (!Array.isArray(days) || days.length === 0 || days.some((d) => typeof d !== 'number' || !BOOST_ALL_DAY_OPTIONS.includes(d))) {
      throw validationError('Pacotes inválidos', { days: `Escolha pelo menos um entre ${BOOST_ALL_DAY_OPTIONS.join(', ')} dias` });
    }
    const chosen = BOOST_ALL_DAY_OPTIONS.filter((d) => (days as number[]).includes(d));
    await this.deps.settings.set({ key: BOOST_DAYS_SETTING_KEY, value: chosen.join(','), updatedAt: this.deps.clock.now(), updatedBy: adminId });
    return chosen;
  }

  async state(): Promise<PaymentsState> {
    const row = await this.deps.settings.get(PAYMENTS_SETTING_KEY);
    const provider = this.deps.payments.provider;
    const chosen = row === undefined ? null : row.value === 'true';
    const canEnable = this.canCharge();
    const verifier = this.deps.storeVerifier;
    const stores = { apple: verifier !== undefined && verifier.supports?.('APPLE') !== false, google: verifier !== undefined && verifier.supports?.('GOOGLE') !== false };
    let updatedBy: string | null = null;
    if (row?.updatedBy) updatedBy = (await this.deps.users.findProfileById(row.updatedBy))?.username ?? null;
    return {
      enabled: canEnable && (chosen ?? this.initial),
      chosen,
      initial: this.initial,
      provider,
      canEnable,
      blocker: canEnable
        ? null
        : 'Não há como cobrar: configure a compra pelas lojas no servidor (APPLE_APP_ID para a App Store, GOOGLE_SERVICE_ACCOUNT_JSON para o Google Play) ou um provedor na web (PAYMENT_PROVIDER).',
      storeAvailable: verifier !== undefined,
      stores,
      offeredDays: await this.offeredDays(),
      packages: BOOST_ALL_DAY_OPTIONS.map((days) => ({ days, productId: `askout.boost.${days}d` })),
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy,
    };
  }

  async set(enabled: boolean, adminId: string): Promise<void> {
    if (typeof enabled !== 'boolean') throw notFound();
    await this.deps.settings.set({ key: PAYMENTS_SETTING_KEY, value: enabled ? 'true' : 'false', updatedAt: this.deps.clock.now(), updatedBy: adminId });
  }
}
