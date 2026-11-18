import { t } from '../lib/i18n/index.ts';
import { addDays, startOfDay } from './agenda.ts';

/**
 * Sincronizar agendas, como nos apps de agenda: a agenda do celular (que já reúne Google, Outlook e iCloud ligados no aparelho),
 * a Google Agenda e o Outlook (login na conta). Tudo direto, sem colar link. Só horários ocupados entram.
 */

export type CalendarSource = 'GOOGLE' | 'MICROSOFT' | 'DEVICE' | 'ICS';
export type CalendarOptionKind = 'DEVICE' | 'GOOGLE' | 'OUTLOOK' | 'ICLOUD';

export interface CalendarChoice {
  id: string;
  name: string;
  selected: boolean;
  color: string | null;
  account: string | null;
}

export interface CalendarConnection {
  id: string;
  provider: CalendarSource;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  label: string;
  accountEmail: string | null;
  calendars: CalendarChoice[];
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface CalendarOverview {
  connections: CalendarConnection[];
  suggestions: { kind: 'GOOGLE' | 'OUTLOOK' | 'ICLOUD'; reason: 'login' | 'email' }[];
  googleAvailable: boolean;
  microsoftAvailable: boolean;
}

export interface BusyBlock {
  start: string;
  end: string;
  connectionId: string;
  provider: CalendarSource;
  label: string;
}

export interface DeviceCalendar {
  id: string;
  name: string;
  account: string | null;
  color: string | null;
}

/** Ponte do app (`window.AskouTDeviceCalendar`, ver apps/mobile): lê a agenda do aparelho. */
export interface DeviceCalendarBridge {
  listCalendars(): Promise<DeviceCalendar[]>;
  busy(o: { calendarIds: string[]; from: string; to: string }): Promise<{ start: string; end: string }[]>;
}

export function deviceCalendarBridge(host: unknown = globalThis): DeviceCalendarBridge | undefined {
  const b = (host as { AskouTDeviceCalendar?: Partial<DeviceCalendarBridge> } | undefined)?.AskouTDeviceCalendar;
  return b && typeof b.listCalendars === 'function' && typeof b.busy === 'function' ? (b as DeviceCalendarBridge) : undefined;
}

export type CalendarLogoKind = 'DEVICE' | 'GOOGLE' | 'OUTLOOK' | 'ICLOUD' | 'OTHER';

export interface CalendarOption {
  kind: CalendarOptionKind;
  logo: CalendarLogoKind;
  name: string;
  hint: string;
  /** Detectada: provavelmente a pessoa tem (está no celular, entrou com o Google, e-mail do provedor). */
  detected: boolean;
  /** Como liga, sempre direto: a agenda do aparelho ou o login na conta (Google, Microsoft). */
  via: 'device' | 'google' | 'microsoft';
  /** Falso quando o servidor ainda não tem a chave daquele provedor ("em breve"). */
  available: boolean;
}

/**
 * Opções na ordem certa: as detectadas primeiro. Tudo é ligação direta (sem colar link).
 * A agenda do celular e o iCloud (que no iPhone vive na agenda do aparelho) só aparecem dentro do app.
 */
export function calendarOptions(overview: Pick<CalendarOverview, 'suggestions' | 'googleAvailable' | 'microsoftAvailable' | 'connections'>, inApp: boolean): CalendarOption[] {
  const detected = new Set<CalendarOptionKind>(overview.suggestions.map((s) => s.kind));
  if (inApp) detected.add('DEVICE');
  // Já ligada: não fica em "Encontramos" (dá para ligar outra conta pelas outras opções).
  if (overview.connections.some((c) => c.provider === 'GOOGLE')) detected.delete('GOOGLE');
  if (overview.connections.some((c) => c.provider === 'MICROSOFT')) detected.delete('OUTLOOK');
  const hasDevice = overview.connections.some((c) => c.provider === 'DEVICE');
  const list: CalendarOption[] = [];
  if (inApp && !hasDevice) list.push({ kind: 'DEVICE', logo: 'DEVICE', name: t('Agenda do celular'), hint: t('Todas as contas do aparelho: iCloud, Google, Outlook e outras'), detected: true, via: 'device', available: true });
  list.push({ kind: 'GOOGLE', logo: 'GOOGLE', name: t('Google Agenda'), hint: t('Entre com sua conta Google'), detected: detected.has('GOOGLE'), via: 'google', available: overview.googleAvailable });
  list.push({ kind: 'OUTLOOK', logo: 'OUTLOOK', name: t('Outlook'), hint: t('Outlook.com, Hotmail ou Microsoft 365'), detected: detected.has('OUTLOOK'), via: 'microsoft', available: overview.microsoftAvailable });
  if (inApp) list.push({ kind: 'ICLOUD', logo: 'ICLOUD', name: t('iCloud'), hint: t('Pela agenda do celular'), detected: detected.has('ICLOUD'), via: 'device', available: true });
  return list.sort((a, b) => Number(b.detected && b.available) - Number(a.detected && a.available));
}

/** Ícone pela conta da agenda (no celular, o nome da conta diz de onde ela vem). */
export function logoForAccount(account: string | null | undefined): CalendarLogoKind {
  const a = (account ?? '').toLowerCase();
  if (/gmail|google/.test(a)) return 'GOOGLE';
  if (/outlook|hotmail|live\.|msn|exchange|office|microsoft/.test(a)) return 'OUTLOOK';
  if (/icloud|me\.com|mac\.com/.test(a)) return 'ICLOUD';
  return 'OTHER';
}

/** Ícone de uma agenda já ligada. */
export function logoForConnection(c: Pick<CalendarConnection, 'provider' | 'label'>): CalendarLogoKind {
  if (c.provider === 'GOOGLE') return 'GOOGLE';
  if (c.provider === 'MICROSOFT') return 'OUTLOOK';
  if (c.provider === 'DEVICE') return 'DEVICE';
  return logoForAccount(c.label);
}

/** Agendas agrupadas por conta, como no app de agenda do celular. */
export function groupByAccount<T extends { account: string | null }>(list: readonly T[]): { account: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const c of list) {
    const key = c.account ?? t('Neste aparelho');
    map.set(key, [...(map.get(key) ?? []), c]);
  }
  return [...map.entries()].map(([account, items]) => ({ account, items }));
}

/** Janela importada: de ontem a 90 dias para a frente (igual ao servidor). */
export function syncWindow(now: Date): { from: string; to: string } {
  return { from: new Date(now.getTime() - 86_400_000).toISOString(), to: new Date(now.getTime() + 90 * 86_400_000).toISOString() };
}

/** A agenda do celular é reenviada ao abrir a agenda, no máximo a cada 30 minutos. */
export function deviceResyncDue(lastIso: string | null, now: Date): boolean {
  const last = lastIso ? Date.parse(lastIso) : NaN;
  return !Number.isFinite(last) || now.getTime() - last >= 30 * 60_000;
}

export function busyOnDay(blocks: readonly BusyBlock[], key: string): BusyBlock[] {
  const dayStart = startOfDay(key).getTime();
  const dayEnd = startOfDay(addDays(key, 1)).getTime();
  return blocks.filter((b) => Date.parse(b.start) < dayEnd && Date.parse(b.end) > dayStart).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Rótulo do botão da agenda: quantas agendas estão ligadas. */
export function syncButtonLabel(count: number): string {
  if (count === 0) return t('Sincronizar');
  return count === 1 ? t('Sincronizar · 1 ligada') : t('Sincronizar · {count} ligadas', { count });
}
