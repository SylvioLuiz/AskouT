import { t } from '../lib/i18n/index.ts';
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export const CONTACTS_MAX = 500;

/** E-mails válidos, em minúsculas, sem repetir. */
export function cleanEmails(raw: string[]): string[] {
  const out = new Set<string>();
  for (const item of raw) {
    const email = item.trim().toLowerCase();
    if (email.length <= 254 && EMAIL.test(email)) out.add(email);
  }
  return [...out];
}

/** E-mails de um arquivo .vcf (linhas EMAIL;...:endereço). Só lê aqui, no aparelho. */
export function emailsFromVcf(text: string): string[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const found: string[] = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const match = /^(?:item\d+\.)?EMAIL[^:]*:(.+)$/i.exec(line.trim());
    if (match) found.push(match[1]!);
  }
  return cleanEmails(found);
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error(t('Este navegador não consegue proteger os contatos. Abra o AskouT por https.'));
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seletor de contatos do navegador (Chrome no Android). */
export function canPickContacts(): boolean {
  const nav = globalThis.navigator as (Navigator & { contacts?: { select?: unknown } }) | undefined;
  return Boolean(nav?.contacts && typeof nav.contacts.select === 'function');
}

export async function pickContactEmails(): Promise<string[]> {
  const nav = navigator as Navigator & { contacts: { select(props: string[], opts: { multiple: boolean }): Promise<{ email?: string[] }[]> } };
  const picked = await nav.contacts.select(['email'], { multiple: true });
  return cleanEmails(picked.flatMap((c) => c.email ?? []));
}
