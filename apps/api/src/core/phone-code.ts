import { rateLimited, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { PhoneCodePurpose } from './types.ts';

/** Mesmas regras do código por e-mail: 10 min de validade, 60 s entre envios, 5 envios e 5 tentativas por código. */
export const PHONE_CODE_TTL_MINUTES = 10;
export const PHONE_RESEND_COOLDOWN_SECONDS = 60;
export const PHONE_MAX_CODE_SENDS = 5;
export const PHONE_MAX_CODE_ATTEMPTS = 5;

export interface PhoneCodeStarted {
  expiresInMinutes: number;
  resendAvailableAt: Date;
}

const INVALID = 'Código inválido ou expirado';

/**
 * Código de 6 números por SMS. Um por pessoa: pedir um novo (de qualquer finalidade) substitui o anterior.
 * O código fica amarrado à pessoa, à finalidade e ao número, então não serve para outra coisa nem para outro celular.
 */
export class PhoneCodeFlow {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  get available(): boolean {
    return this.deps.sms !== undefined;
  }

  async send(userId: string, phone: string, purpose: PhoneCodePurpose): Promise<PhoneCodeStarted> {
    const { phoneCodes, codes, clock, sms } = this.deps;
    if (!sms) throw validationError('O envio de SMS ainda não está disponível', { phone: 'O envio de SMS ainda não está disponível' });
    const now = clock.now();
    const existing = await phoneCodes.find(userId);
    const active = existing && existing.purpose === purpose && existing.phone === phone && existing.expiresAt.getTime() > now.getTime() ? existing : undefined;
    if (active) {
      const waitMs = active.lastSentAt.getTime() + PHONE_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime();
      if (waitMs > 0) throw rateLimited('Aguarde um pouco para pedir um novo código.', waitMs / 1000);
      if (active.sendCount >= PHONE_MAX_CODE_SENDS) {
        throw rateLimited('Muitos códigos enviados para este celular. Tente novamente mais tarde.', (active.expiresAt.getTime() - now.getTime()) / 1000);
      }
    }
    const code = codes.generate();
    await phoneCodes.save({
      userId,
      purpose,
      phone,
      codeHash: codes.hash(key(userId, phone, purpose), code),
      expiresAt: new Date(now.getTime() + PHONE_CODE_TTL_MINUTES * 60_000),
      attempts: 0,
      sendCount: (active?.sendCount ?? 0) + 1,
      lastSentAt: now,
    });
    try {
      await sms.sendCode({ to: phone, code, purpose, expiresInMinutes: PHONE_CODE_TTL_MINUTES });
    } catch {
      await phoneCodes.delete(userId);
      throw validationError('Não conseguimos enviar o SMS agora. Tente de novo em instantes.', { phone: 'Não conseguimos enviar o SMS agora. Tente de novo em instantes.' });
    }
    return { expiresInMinutes: PHONE_CODE_TTL_MINUTES, resendAvailableAt: new Date(now.getTime() + PHONE_RESEND_COOLDOWN_SECONDS * 1000) };
  }

  /** Confere e consome o código. Lança VALIDATION (incorreto/expirado) ou RATE_LIMITED (tentativas demais). */
  async consume(userId: string | undefined, phone: string, purpose: PhoneCodePurpose, rawCode: string): Promise<void> {
    const { phoneCodes, codes, clock } = this.deps;
    const code = rawCode.trim();
    if (!/^\d{6}$/.test(code)) throw validationError('Código inválido', { code: 'O código tem 6 números' });
    const record = userId ? await phoneCodes.find(userId) : undefined;
    if (!userId || !record || record.purpose !== purpose || record.phone !== phone || record.expiresAt.getTime() <= clock.now().getTime()) {
      if (userId && record && record.expiresAt.getTime() <= clock.now().getTime()) await phoneCodes.delete(userId);
      throw validationError(INVALID, { code: INVALID });
    }
    if (record.attempts >= PHONE_MAX_CODE_ATTEMPTS) {
      await phoneCodes.delete(userId);
      throw rateLimited('Muitas tentativas incorretas. Peça um novo código.');
    }
    if (!codes.matches(key(userId, phone, purpose), code, record.codeHash)) {
      const attempts = await phoneCodes.incrementAttempts(userId);
      if (attempts === undefined) throw validationError(INVALID, { code: INVALID });
      if (attempts >= PHONE_MAX_CODE_ATTEMPTS) {
        await phoneCodes.delete(userId);
        throw rateLimited('Muitas tentativas incorretas. Peça um novo código.');
      }
      throw validationError('Código incorreto', { code: 'Código incorreto' });
    }
    await phoneCodes.delete(userId);
  }
}

function key(userId: string, phone: string, purpose: PhoneCodePurpose): string {
  return `sms:${purpose}:${userId}:${phone}`;
}
