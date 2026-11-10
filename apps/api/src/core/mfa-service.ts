import { randomInt } from 'node:crypto';
import { conflict, notFound, rateLimited, unauthorized, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import { generateTotpSecret, matchTotp, otpauthUrl } from './totp.ts';
import type { UserMfa } from './types.ts';
import { asString } from './validation.ts';

export const MFA_ISSUER = 'Askout';
export const RECOVERY_CODE_COUNT = 10;
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_MINUTES = 15;

/** Sem 0/O e 1/I/L, para não confundir ao digitar. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 10;

export interface MfaStatus {
  enabled: boolean;
  /** Começou a configurar e ainda não confirmou com um código. */
  pendingSetup: boolean;
  recoveryCodesLeft: number;
}

export interface MfaSetup {
  /** Chave para digitar no app, caso não dê para ler o QR code. */
  secret: string;
  /** Conteúdo do QR code. */
  otpauthUrl: string;
  issuer: string;
  account: string;
}

export interface MfaRecoveryCodes {
  /** Mostrados uma única vez; no banco fica só o HMAC. */
  recoveryCodes: string[];
}

/**
 * Verificação em duas etapas por app autenticador (TOTP), opcional para cada conta.
 *  - configurar: gera o segredo (QR code) -> a pessoa confirma com um código do app -> liga e recebe 10 códigos de recuperação;
 *  - no login, depois da senha (ou do Google/Apple), pede o código do app ou um de recuperação (cada um vale uma vez);
 *  - 5 códigos errados seguidos bloqueiam por 15 minutos; o mesmo código do app não vale duas vezes.
 */
export class MfaService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.deps.mfa.find(userId);
    return Boolean(record?.enabledAt);
  }

  async status(userId: string): Promise<MfaStatus> {
    const record = await this.deps.mfa.find(userId);
    return {
      enabled: Boolean(record?.enabledAt),
      pendingSetup: Boolean(record && !record.enabledAt),
      recoveryCodesLeft: record?.enabledAt ? record.recoveryCodeHashes.length : 0,
    };
  }

  /** Etapa 1: novo segredo. Refazer antes de confirmar troca o segredo (o QR antigo deixa de valer). */
  async setup(userId: string): Promise<MfaSetup> {
    const { users, mfa, secretBox, clock } = this.deps;
    const user = await users.findById(userId);
    if (!user || user.status === 'SUSPENDED') throw unauthorized('Sessão inválida');
    const existing = await mfa.find(userId);
    if (existing?.enabledAt) throw conflict('A verificação em duas etapas já está ligada. Desligue antes de configurar de novo.');

    const secret = generateTotpSecret();
    await mfa.save({
      userId,
      secretSealed: secretBox.seal(secret),
      enabledAt: null,
      recoveryCodeHashes: [],
      lastUsedStep: -1,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: clock.now(),
    });
    const account = user.email;
    return { secret, otpauthUrl: otpauthUrl({ secret, account, issuer: MFA_ISSUER }), issuer: MFA_ISSUER, account };
  }

  /** Etapa 2: confere o primeiro código do app, liga e devolve os códigos de recuperação. */
  async enable(userId: string, rawCode: unknown): Promise<MfaRecoveryCodes> {
    const record = await this.deps.mfa.find(userId);
    if (!record) throw notFound('Comece a configuração de novo.');
    if (record.enabledAt) throw conflict('A verificação em duas etapas já está ligada.');
    await this.check(record, rawCode, { allowRecovery: false });
    const recoveryCodes = this.newRecoveryCodes();
    const fresh = await this.deps.mfa.find(userId);
    await this.deps.mfa.save({ ...(fresh ?? record), enabledAt: this.deps.clock.now(), recoveryCodeHashes: recoveryCodes.map((c) => this.hashRecovery(userId, c)) });
    return { recoveryCodes };
  }

  /** Desliga, pedindo um código (do app ou de recuperação) para quem só pegou o celular desbloqueado não conseguir. */
  async disable(userId: string, rawCode: unknown): Promise<{ enabled: false }> {
    const record = await this.deps.mfa.find(userId);
    if (!record?.enabledAt) {
      if (record) await this.deps.mfa.delete(userId);
      return { enabled: false };
    }
    await this.check(record, rawCode, { allowRecovery: true });
    await this.deps.mfa.delete(userId);
    return { enabled: false };
  }

  /** Gera outros 10 códigos de recuperação; os anteriores param de valer. */
  async regenerateRecoveryCodes(userId: string, rawCode: unknown): Promise<MfaRecoveryCodes> {
    const record = await this.deps.mfa.find(userId);
    if (!record?.enabledAt) throw notFound('A verificação em duas etapas não está ligada.');
    await this.check(record, rawCode, { allowRecovery: false });
    const recoveryCodes = this.newRecoveryCodes();
    const fresh = (await this.deps.mfa.find(userId)) ?? record;
    await this.deps.mfa.save({ ...fresh, recoveryCodeHashes: recoveryCodes.map((c) => this.hashRecovery(userId, c)) });
    return { recoveryCodes };
  }

  /** Segunda etapa do login. Lança erro se o código não vale. */
  async verifyLogin(userId: string, rawCode: unknown): Promise<void> {
    const record = await this.deps.mfa.find(userId);
    if (!record?.enabledAt) return;
    await this.check(record, rawCode, { allowRecovery: true });
  }

  private async check(record: UserMfa, rawCode: unknown, options: { allowRecovery: boolean }): Promise<void> {
    const { mfa, secretBox, clock } = this.deps;
    const now = clock.now();
    if (record.lockedUntil && record.lockedUntil.getTime() > now.getTime()) {
      throw rateLimited('Muitos códigos incorretos. Espere alguns minutos e tente de novo.', (record.lockedUntil.getTime() - now.getTime()) / 1000);
    }

    const code = asString(rawCode).trim();
    const digits = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(digits)) {
      const secret = secretBox.open(record.secretSealed);
      if (!secret) throw new Error('Segredo do autenticador ilegível (CODE_SECRET trocado?)');
      const step = matchTotp(secret, digits, now, record.lastUsedStep);
      if (step !== undefined && (await mfa.useStep(record.userId, step))) return;
    } else if (options.allowRecovery) {
      const normalized = normalizeRecovery(code);
      if (normalized.length === RECOVERY_LENGTH && (await mfa.useRecoveryCode(record.userId, this.hashRecovery(record.userId, normalized)))) return;
    }

    const failures = await mfa.incrementFailures(record.userId);
    if (failures !== undefined && failures >= MFA_MAX_FAILURES) {
      await mfa.lock(record.userId, new Date(now.getTime() + MFA_LOCK_MINUTES * 60_000));
      throw rateLimited('Muitos códigos incorretos. Espere alguns minutos e tente de novo.', MFA_LOCK_MINUTES * 60);
    }
    throw validationError('Código incorreto', { code: 'Código incorreto' });
  }

  private newRecoveryCodes(): string[] {
    const out: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      let raw = '';
      for (let j = 0; j < RECOVERY_LENGTH; j += 1) raw += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
      out.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
    }
    return out;
  }

  private hashRecovery(userId: string, code: string): string {
    return this.deps.codes.hash(`mfa-recovery:${userId}`, normalizeRecovery(code));
  }
}

function normalizeRecovery(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
