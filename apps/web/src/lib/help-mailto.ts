import { t } from '../lib/i18n/index.ts';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Link de e-mail para o suporte, ou nada se o endereço não estiver configurado (VITE_SUPPORT_EMAIL). */
export function supportMailto(email: string | undefined, username: string): string | undefined {
  const address = email?.trim();
  if (!address || !EMAIL.test(address)) return undefined;
  const subject = encodeURIComponent(t('Ajuda com o AskouT'));
  const body = encodeURIComponent(`\n\n—\n${t('Meu usuário: @{username}', { username })}`);
  return `mailto:${address}?subject=${subject}&body=${body}`;
}
