import { t } from '../lib/i18n/index.ts';
/** Mensagem de voz: os limites são os mesmos da API (1 a 90 s, até 600 KB). */
export const VOICE_MAX_MS = 90_000;
export const VOICE_MIN_MS = 1_000;
export const VOICE_MAX_BYTES = 600 * 1024;
/** ~32 kbps: 90 s ficam perto de 360 KB, bem abaixo do limite. */
export const VOICE_BITS_PER_SECOND = 32_000;

const PREFERRED = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

/** O primeiro formato de gravação que este navegador sabe fazer (Chrome: webm, Safari: mp4, Firefox: ogg). */
export function pickVoiceMime(isSupported: (mime: string) => boolean): string | undefined {
  return PREFERRED.find((mime) => isSupported(mime));
}

/** "0:07", "1:30". */
export function formatVoiceTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type VoiceProblem = 'unsupported' | 'denied' | 'no-device' | 'failed';

export function voiceProblemMessage(problem: VoiceProblem): string {
  switch (problem) {
    case 'unsupported':
      return t('Este navegador não consegue gravar áudio. Abra o AskouT em https no Chrome, Safari ou Firefox atualizados.');
    case 'denied':
      return t('O microfone está bloqueado. Libere nas configurações do navegador ou do celular para gravar.');
    case 'no-device':
      return t('Não encontramos um microfone neste aparelho.');
    default:
      return t('Não foi possível gravar o áudio. Tente de novo.');
  }
}

/** Traduz o erro do getUserMedia. */
export function voiceProblemFrom(error: unknown): VoiceProblem {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
  return 'failed';
}
