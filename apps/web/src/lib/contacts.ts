import { t } from '../lib/i18n/index.ts';
import { normalizePhone } from './phone.ts';
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export const CONTACTS_MAX = 500;
/** Celulares por busca (a agenda do celular costuma ter mais números que e-mails). Igual ao limite do servidor. */
export const CONTACT_PHONES_MAX = 3000;

/** O que sai da agenda para conferir: e-mails e celulares, ainda em claro (viram código antes de ir ao servidor). */
export interface ContactKeys {
  emails: string[];
  phones: string[];
}

/** E-mails válidos, em minúsculas, sem repetir. */
export function cleanEmails(raw: string[]): string[] {
  const out = new Set<string>();
  for (const item of raw) {
    const email = item.trim().toLowerCase();
    if (email.length <= 254 && EMAIL.test(email)) out.add(email);
  }
  return [...out];
}

/** Celulares em E.164 (+55...), sem repetir; descarta o que não é número de telefone. */
export function cleanPhones(raw: string[]): string[] {
  const out = new Set<string>();
  for (const item of raw) {
    const phone = normalizePhone(item);
    if (phone) out.add(phone);
  }
  return [...out];
}

const VCF_LINE = { EMAIL: /^(?:item\d+\.)?EMAIL[^:]*:(.+)$/i, TEL: /^(?:item\d+\.)?TEL[^:]*:(.+)$/i };

function vcfValues(text: string, field: keyof typeof VCF_LINE): string[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const found: string[] = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const match = VCF_LINE[field].exec(line.trim());
    if (match) found.push(match[1]!.replace(/^tel:/i, ''));
  }
  return found;
}

/** E-mails de um arquivo .vcf (linhas EMAIL;...:endereço). Só lê aqui, no aparelho. */
export function emailsFromVcf(text: string): string[] {
  return cleanEmails(vcfValues(text, 'EMAIL'));
}

/** Celulares de um arquivo .vcf (linhas TEL;...:número). */
export function phonesFromVcf(text: string): string[] {
  return cleanPhones(vcfValues(text, 'TEL'));
}

export function keysFromVcf(text: string): ContactKeys {
  return { emails: emailsFromVcf(text), phones: phonesFromVcf(text) };
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

export async function pickContacts(): Promise<ContactKeys> {
  const nav = navigator as Navigator & { contacts: { select(props: string[], opts: { multiple: boolean }): Promise<{ email?: string[]; tel?: string[] }[]> } };
  const picked = await nav.contacts.select(['email', 'tel'], { multiple: true });
  return { emails: cleanEmails(picked.flatMap((c) => c.email ?? [])), phones: cleanPhones(picked.flatMap((c) => c.tel ?? [])) };
}

/** Ponte do app do celular (apps/mobile/src/contacts-bridge.ts): lê a agenda inteira, com a permissão do aparelho. */
interface ContactsBridge {
  readAll(): Promise<{ emails: string[]; phones: string[] }>;
}

function deviceBridge(): ContactsBridge | undefined {
  const bridge = (globalThis as Record<string, unknown>)['AskouTContacts'] as ContactsBridge | undefined;
  return bridge && typeof bridge.readAll === 'function' ? bridge : undefined;
}

/** No app do celular dá para sincronizar a agenda toda de uma vez. */
export function canSyncDeviceContacts(): boolean {
  return deviceBridge() !== undefined;
}

export async function readDeviceContacts(): Promise<ContactKeys> {
  const bridge = deviceBridge();
  if (!bridge) throw new Error(t('A agenda só pode ser lida pelo app do AskouT no celular.'));
  const all = await bridge.readAll();
  return { emails: cleanEmails(all.emails), phones: cleanPhones(all.phones) };
}

/** Códigos SHA-256 que vão ao servidor, dentro dos limites. */
export async function hashContactKeys(keys: ContactKeys): Promise<{ hashes: string[]; phoneHashes: string[]; truncated: boolean }> {
  const emails = keys.emails.slice(0, CONTACTS_MAX);
  const phones = keys.phones.slice(0, CONTACT_PHONES_MAX);
  const [hashes, phoneHashes] = await Promise.all([Promise.all(emails.map(sha256Hex)), Promise.all(phones.map(sha256Hex))]);
  return { hashes, phoneHashes, truncated: emails.length < keys.emails.length || phones.length < keys.phones.length };
}
