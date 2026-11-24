/**
 * Lembretes de evento (push) que a pessoa escolhe: quantos e com quanto tempo antes.
 *
 * - Padrão (quem nunca mexeu): "É hoje!" de manhã no dia do evento e "Começa daqui a pouco" 30 min antes.
 * - A escolha geral fica em Configuração > Notificações; cada evento pode ter a sua, que vale no lugar da geral.
 * - Cada lembrete sai uma vez só por pessoa e evento (marcado por tipo, ver EventRoomRepository.markReminded).
 *
 * Regras de quando sai (ver `dueReminder`):
 * - o horário do lembrete chegou e o evento ainda não começou;
 * - a pessoa já tinha confirmado (ou criado o evento) antes desse horário: quem acabou de confirmar não precisa ser lembrado;
 * - não saiu atrasado demais (`LATE_MS`): se o servidor ficou parado, não chega um "É amanhã!" no dia do evento;
 * - "É hoje!" só quando o evento começa pelo menos 1 h depois da manhã (senão os lembretes de minutos já cobrem);
 * - se dois lembretes vencem juntos, só o mais próximo do começo sai; o outro é dado como feito.
 */
export const EVENT_REMINDER_OPTIONS = ['1d', 'manha', '2h', '1h', '30m', '15m'] as const;
export type EventReminderOption = (typeof EVENT_REMINDER_OPTIONS)[number];

export const DEFAULT_EVENT_REMINDERS: readonly EventReminderOption[] = ['manha', '30m'];
/** Fuso de quem nunca mandou o seu (o app manda o do aparelho ao salvar a escolha). */
export const DEFAULT_REMINDER_TIME_ZONE = 'America/Sao_Paulo';
/** Hora do "É hoje!", no fuso da pessoa. */
export const MORNING_HOUR = 9;
/** "É hoje!" só sai se o evento começa pelo menos isto depois da manhã. */
const MORNING_MIN_LEAD_MS = 60 * 60_000;
const MINUTE = 60_000;

const OFFSET_MS: Record<Exclude<EventReminderOption, 'manha'>, number> = { '1d': 24 * 60 * MINUTE, '2h': 120 * MINUTE, '1h': 60 * MINUTE, '30m': 30 * MINUTE, '15m': 15 * MINUTE };
/** O maior adiantamento possível: até quanto à frente o job procura eventos. */
export const MAX_REMINDER_LEAD_MS = OFFSET_MS['1d'];

export function isEventReminderOption(value: unknown): value is EventReminderOption {
  return typeof value === 'string' && (EVENT_REMINDER_OPTIONS as readonly string[]).includes(value);
}

/** Ordem fixa (do mais cedo ao mais perto do começo), sem repetir. */
export function sortReminders(list: readonly EventReminderOption[]): EventReminderOption[] {
  return EVENT_REMINDER_OPTIONS.filter((o) => list.includes(o));
}

/** Como fica guardado no banco: `manha,30m`; texto vazio é "nenhum lembrete". */
export function encodeReminders(list: readonly EventReminderOption[]): string {
  return sortReminders(list).join(',');
}

/** Lê o que está no banco; o que não for conhecido é ignorado. */
export function decodeReminders(value: string): EventReminderOption[] {
  return sortReminders(value.split(',').map((s) => s.trim()).filter(isEventReminderOption));
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function zoneOrDefault(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_REMINDER_TIME_ZONE;
}

/** Dia do calendário (AAAA-MM-DD) de `at` no fuso. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Quanto o fuso está à frente do UTC em `at` (em ms; Brasil é negativo). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - (at.getTime() - at.getMilliseconds());
}

/** O instante de `hour`:00 no dia `day` (AAAA-MM-DD) do fuso. */
export function atLocalHour(day: string, hour: number, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, hour, 0, 0);
  let guess = naive - zoneOffsetMs(new Date(naive), timeZone);
  // Segunda volta: perto da troca de horário de verão o deslocamento muda.
  guess = naive - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Quando o lembrete sai para um evento que começa em `startsAt`; nulo se este lembrete não vale para ele. */
export function reminderAt(option: EventReminderOption, startsAt: Date, timeZone: string | null | undefined): Date | null {
  if (option !== 'manha') return new Date(startsAt.getTime() - OFFSET_MS[option]);
  const zone = zoneOrDefault(timeZone);
  const morning = atLocalHour(localDay(startsAt, zone), MORNING_HOUR, zone);
  return startsAt.getTime() - morning.getTime() >= MORNING_MIN_LEAD_MS ? morning : null;
}

/** Até quanto depois do horário o lembrete ainda sai (servidor parado, pessoa mudou a escolha em cima da hora). */
function lateMs(option: EventReminderOption): number {
  return option === 'manha' ? 60 * MINUTE : Math.min(OFFSET_MS[option], 60 * MINUTE);
}

/**
 * Os lembretes vencidos agora: `send` é o que deve sair (o mais perto do começo) e `skip` os que vencem junto e
 * só são dados como feitos. Nada vencido: `send` nulo e `skip` vazio.
 */
export function dueReminder(input: { options: readonly EventReminderOption[]; startsAt: Date; joinedAt: Date; now: Date; timeZone: string | null | undefined }): { send: EventReminderOption | null; skip: EventReminderOption[] } {
  const { startsAt, joinedAt, now } = input;
  if (startsAt.getTime() <= now.getTime()) return { send: null, skip: [] };
  const due: { option: EventReminderOption; at: number }[] = [];
  for (const option of input.options) {
    const at = reminderAt(option, startsAt, input.timeZone);
    if (!at) continue;
    const t = at.getTime();
    if (t > now.getTime() || now.getTime() - t > lateMs(option) || joinedAt.getTime() > t) continue;
    due.push({ option, at: t });
  }
  if (due.length === 0) return { send: null, skip: [] };
  due.sort((a, b) => b.at - a.at);
  return { send: due[0]!.option, skip: due.slice(1).map((d) => d.option) };
}

function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

function inMinutes(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `em ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `em ${h} h` : `em ${h} h ${m} min`;
}

/** Título e texto do push. O horário sai no fuso da pessoa. */
export function reminderText(input: { option: EventReminderOption; title: string; where: string | null; startsAt: Date; now: Date; timeZone: string | null | undefined }): { title: string; body: string } {
  const zone = zoneOrDefault(input.timeZone);
  const { option, startsAt, now } = input;
  const left = startsAt.getTime() - now.getTime();
  const today = localDay(now, zone) === localDay(startsAt, zone);
  const tomorrow = localDay(new Date(now.getTime() + 24 * 60 * MINUTE), zone) === localDay(startsAt, zone);
  const day = today ? 'hoje' : tomorrow ? 'amanhã' : null;
  const when = left < 60 * MINUTE ? inMinutes(left) : day ? `${day} às ${clock(startsAt, zone)}` : inMinutes(left);
  const title = option === '1d' ? (tomorrow ? 'É amanhã!' : today ? 'É hoje!' : `Começa ${inMinutes(left)}`) : option === 'manha' ? 'É hoje!' : left <= 30 * MINUTE + MINUTE ? 'Começa daqui a pouco' : `Começa ${inMinutes(left)}`;
  const body = [`"${input.title}"`, when, ...(input.where ? [input.where] : [])].join(' · ');
  return { title, body };
}

/** Escolha que veio da tela: lista de lembretes conhecidos, sem repetir (vazia = nenhum). Devolve nulo se for inválida. */
export function parseReminderList(value: unknown): EventReminderOption[] | null {
  if (!Array.isArray(value) || value.length > EVENT_REMINDER_OPTIONS.length * 2) return null;
  if (!value.every(isEventReminderOption)) return null;
  return sortReminders(value);
}

/** O que a tela mostra da escolha: a lista que vale e se é a personalizada ou o padrão. */
export interface EventReminderChoiceView {
  reminders: EventReminderOption[];
  /** true: a pessoa escolheu; false: segue o padrão (ou, num evento, a escolha geral). */
  custom: boolean;
}
