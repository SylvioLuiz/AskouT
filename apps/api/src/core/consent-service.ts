import { validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ConsentPurpose, ConsentSource } from './types.ts';
import { TERMS_VERSION } from './age-service.ts';

/** Usos opcionais, na ordem em que aparecem no app. Todos começam desligados (opt-in). */
export const CONSENT_PURPOSES: readonly ConsentPurpose[] = ['MARKETING_EMAIL', 'MARKETING_PUSH'];

/** Quantos registros do histórico a tela mostra. */
export const CONSENT_HISTORY_LIMIT = 50;

export interface ConsentView {
  purpose: ConsentPurpose;
  granted: boolean;
  /** Quando foi dado ou tirado pela última vez. `null` se a pessoa nunca mexeu (desligado). */
  updatedAt: string | null;
}

export interface ConsentHistoryItem {
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  at: string;
}

export interface ConsentStatus {
  /** Aceite dos Termos de Uso e da Política de Privacidade (obrigatório para ter a conta). */
  terms: { currentVersion: string; acceptedVersion: string | null; acceptedAt: string | null };
  consents: ConsentView[];
  history: ConsentHistoryItem[];
}

function isPurpose(value: unknown): value is ConsentPurpose {
  return typeof value === 'string' && (CONSENT_PURPOSES as readonly string[]).includes(value);
}

/**
 * Consentimentos opcionais (LGPD): receber novidades por e-mail e por notificação.
 * Cada mudança vira um registro novo, com data e origem, e nada é apagado até a conta ser apagada:
 * assim dá para provar quando a pessoa disse sim ou não.
 */
export class ConsentService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async status(userId: string): Promise<ConsentStatus> {
    const user = await this.deps.users.findById(userId);
    const events = await this.deps.consents.listByUser(userId, 500);
    const consents = CONSENT_PURPOSES.map((purpose): ConsentView => {
      const last = events.find((e) => e.purpose === purpose);
      return { purpose, granted: last?.granted ?? false, updatedAt: last ? last.at.toISOString() : null };
    });
    return {
      terms: {
        currentVersion: TERMS_VERSION,
        acceptedVersion: user?.termsVersion ?? null,
        acceptedAt: user?.termsVersion && user.termsAcceptedAt ? new Date(user.termsAcceptedAt).toISOString() : null,
      },
      consents,
      history: events.slice(0, CONSENT_HISTORY_LIMIT).map((e) => ({ purpose: e.purpose, granted: e.granted, source: e.source, at: e.at.toISOString() })),
    };
  }

  /** Liga ou desliga um uso opcional. Repetir o mesmo valor não cria registro novo. */
  async set(userId: string, input: { purpose?: unknown; granted?: unknown }): Promise<ConsentStatus> {
    if (!isPurpose(input.purpose)) throw validationError('Opção de privacidade inválida', { purpose: 'Opção inválida' });
    if (typeof input.granted !== 'boolean') throw validationError('Informe se a opção fica ligada ou desligada', { granted: 'Use true ou false' });
    if ((await this.isGranted(userId, input.purpose)) !== input.granted) {
      await this.deps.consents.add({ id: this.deps.ids.next(), userId, purpose: input.purpose, granted: input.granted, source: 'SETTINGS', at: this.deps.clock.now() });
    }
    return this.status(userId);
  }

  /** Se a pessoa permite esse uso agora. Quem nunca respondeu conta como "não". Quem mandar novidades tem que conferir isto antes. */
  async isGranted(userId: string, purpose: ConsentPurpose): Promise<boolean> {
    const events = await this.deps.consents.listByUser(userId, 500);
    return events.find((e) => e.purpose === purpose)?.granted ?? false;
  }
}
