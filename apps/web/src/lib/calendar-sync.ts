import { t } from '../lib/i18n/index.ts';
import { addDays, startOfDay } from './agenda.ts';

/**
 * Sincronizar agendas, como nos apps de agenda: a agenda do celular (que já reúne Google, Outlook e iCloud ligados no aparelho),
 * a Google Agenda (permissão do Google) e links iCal (Outlook, iCloud e outras). Só horários ocupados entram.
 */

export type CalendarSource = 'GOOGLE' | 'DEVICE' | 'ICS';
export type CalendarOptionKind = 'DEVICE' | 'GOOGLE' | 'OUTLOOK' | 'ICLOUD' | 'ICS';

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

export interface CalendarOption {
  kind: CalendarOptionKind;
  name: string;
  hint: string;
  /** Detectada: provavelmente a pessoa tem (está no celular, entrou com o Google, e-mail do provedor). */
  detected: boolean;
  /** Como liga: no próprio app (celular), pela permissão do Google ou colando o link iCal. */
  via: 'device' | 'google' | 'ics';
}

/** Opções na ordem certa: as detectadas primeiro. A agenda do celular só aparece dentro do app. */
export function calendarOptions(overview: Pick<CalendarOverview, 'suggestions' | 'googleAvailable' | 'connections'>, inApp: boolean): CalendarOption[] {
  const detected = new Set<CalendarOptionKind>(overview.suggestions.map((s) => s.kind));
  if (inApp) detected.add('DEVICE');
  // Já ligada: não fica em "Encontramos" (dá para ligar outra conta pelas outras opções).
  if (overview.connections.some((c) => c.provider === 'GOOGLE')) detected.delete('GOOGLE');
  const list: CalendarOption[] = [];
  if (inApp) list.push({ kind: 'DEVICE', name: t('Agenda do celular'), hint: t('Google, Outlook, iCloud e outras contas já ligadas no aparelho'), detected: true, via: 'device' });
  list.push({ kind: 'GOOGLE', name: t('Google Agenda'), hint: overview.googleAvailable ? t('Entre com sua conta Google e escolha as agendas') : t('Cole o endereço secreto em formato iCal'), detected: detected.has('GOOGLE'), via: overview.googleAvailable ? 'google' : 'ics' });
  list.push({ kind: 'OUTLOOK', name: t('Outlook'), hint: t('Cole o link de publicação da agenda (ICS)'), detected: detected.has('OUTLOOK'), via: 'ics' });
  list.push({ kind: 'ICLOUD', name: t('iCloud'), hint: t('Cole o link da agenda pública'), detected: detected.has('ICLOUD'), via: 'ics' });
  list.push({ kind: 'ICS', name: t('Outro link iCal'), hint: t('Qualquer agenda que tenha link .ics ou webcal://'), detected: false, via: 'ics' });
  // Celular já ligado não precisa aparecer de novo como opção.
  const hasDevice = overview.connections.some((c) => c.provider === 'DEVICE');
  return list.filter((o) => !(o.kind === 'DEVICE' && hasDevice)).sort((a, b) => Number(b.detected) - Number(a.detected));
}

/** Passo a passo curto para achar o link iCal em cada provedor. */
export function icsHelp(kind: CalendarOptionKind): string[] {
  switch (kind) {
    case 'GOOGLE':
      return [t('No computador, abra a Google Agenda e vá em Configurações.'), t('Clique na agenda, em "Integrar agenda".'), t('Copie o "Endereço secreto no formato iCal" e cole aqui.')];
    case 'OUTLOOK':
      return [t('No Outlook na web, abra Configurações > Calendário > Calendários compartilhados.'), t('Em "Publicar um calendário", escolha a agenda e "Pode ver quando estou ocupado".'), t('Clique em Publicar e copie o link ICS.')];
    case 'ICLOUD':
      return [t('No app Calendário do iPhone, toque em Calendários e no (i) da agenda.'), t('Ative "Calendário público" e toque em Compartilhar Link.'), t('Copie o link (webcal://) e cole aqui.')];
    default:
      return [t('Cole o endereço da agenda em formato iCal (.ics ou webcal://).')];
  }
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
