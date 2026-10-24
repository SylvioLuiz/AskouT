/**
 * Leitor de calendário iCal (.ics), o formato que o Google Agenda, o Apple Calendar e o Outlook publicam.
 *
 * Lê só o que o AskouT precisa: título, descrição, local, link, início e fim de cada VEVENT, com fuso horário
 * (TZID), eventos que se repetem (RRULE: dia, semana, mês e ano; INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY),
 * datas excluídas (EXDATE), ocorrências alteradas (RECURRENCE-ID) e cancelados (STATUS:CANCELLED).
 * O que não for suportado (por exemplo BYSETPOS) é ignorado, sem derrubar a leitura.
 * Eventos de dia inteiro (sem hora) são contados à parte e não viram ocorrência: não servem para um evento com horário.
 */

export interface IcsOccurrence {
  uid: string;
  /** Início desta ocorrência (UTC). */
  start: Date;
  end: Date;
  /** Início original da ocorrência na série; identifica a ocorrência mesmo se alguém mudar o horário. */
  originalStart: Date;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
}

export interface IcsParseOptions {
  /** Só ocorrências que começam a partir daqui. */
  from: Date;
  /** ... e até aqui. */
  to: Date;
  /** Fuso para horários sem fuso informado. */
  defaultTimeZone?: string;
  /** Teto de ocorrências devolvidas. */
  max?: number;
}

export interface IcsParseResult {
  events: IcsOccurrence[];
  /** VEVENT de dia inteiro, ignorados. */
  skippedAllDay: number;
  /** Havia calendário (BEGIN:VCALENDAR)? Falso quando o link não é de um calendário. */
  isCalendar: boolean;
}

export const ICS_DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const DAY = 86_400_000;
const MAX_STEPS = 6000;

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Junta as linhas dobradas (continuação começa com espaço ou tab) e separa em linhas. */
export function unfold(text: string): string[] {
  return text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** "NOME;PARAM=a;PARAM2="b:c":valor" -> partes. O primeiro ":" fora de aspas separa o valor. */
function parseLine(line: string): Prop | undefined {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return undefined;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = '';
  inQuote = false;
  for (const ch of head) {
    if (ch === '"') {
      inQuote = !inQuote;
      cur += ch;
    } else if (ch === ';' && !inQuote) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const name = (parts[0] ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

// ---------- fusos ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat | undefined {
  const cached = formatters.get(tz);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
    return f;
  } catch {
    return undefined;
  }
}

export function isKnownTimeZone(tz: string): boolean {
  return tz === 'UTC' || formatterFor(tz) !== undefined;
}

/** Diferença (em ms) entre o relógio de parede em `tz` e o UTC, no instante `ms`. */
function offsetAt(tz: string, ms: number): number {
  if (tz === 'UTC') return 0;
  const f = formatterFor(tz);
  if (!f) return 0;
  const get: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') get[p.type] = Number(p.value);
  const asUtc = Date.UTC(get['year'] ?? 1970, (get['month'] ?? 1) - 1, get['day'] ?? 1, get['hour'] === 24 ? 0 : (get['hour'] ?? 0), get['minute'] ?? 0, get['second'] ?? 0);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Relógio de parede (ano, mês 1-12, dia, hora, minuto, segundo) em `tz` -> instante UTC. */
export function wallToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number, s: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guess - offsetAt(tz, guess);
  utc = guess - offsetAt(tz, utc);
  return new Date(utc);
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

interface When {
  /** Instante UTC. */
  at: Date;
  /** Relógio de parede no fuso do evento (base para repetir no mesmo horário local). */
  wall: Wall;
  tz: string;
  allDay: boolean;
}

function parseWhen(prop: Prop, defaultTz: string): When | undefined {
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined) return { at: new Date(Date.UTC(y, mo - 1, d)), wall: { y, mo, d, h: 0, mi: 0, s: 0 }, tz: 'UTC', allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? '0')];
  if (m[7] === 'Z') return { at: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), wall: { y, mo, d, h, mi, s }, tz: 'UTC', allDay: false };
  const asked = prop.params['TZID'];
  const tz = asked && isKnownTimeZone(asked) ? asked : defaultTz;
  return { at: wallToUtc(tz, y, mo, d, h, mi, s), wall: { y, mo, d, h, mi, s }, tz, allDay: false };
}

function parseDuration(v: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = (x: string | undefined) => Number(x ?? '0');
  const ms = n(m[2]) * 7 * DAY + n(m[3]) * DAY + n(m[4]) * 3_600_000 + n(m[5]) * 60_000 + n(m[6]) * 1000;
  return m[1] === '-' ? -ms : ms;
}

// ---------- repetição ----------

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | undefined;
  until: Date | undefined;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
}

function parseRule(value: string, defaultTz: string, tz: string): Rule | undefined {
  const parts: Record<string, string> = {};
  for (const kv of value.split(';')) {
    const eq = kv.indexOf('=');
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = parts['FREQ'];
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return undefined;
  const interval = Math.max(1, Math.min(1000, Number(parts['INTERVAL'] ?? '1') || 1));
  const count = parts['COUNT'] === undefined ? undefined : Math.max(0, Number(parts['COUNT']) || 0);
  let until: Date | undefined;
  if (parts['UNTIL']) {
    const w = parseWhen({ name: 'UNTIL', params: { TZID: tz }, value: parts['UNTIL'] }, defaultTz);
    if (w) until = w.allDay ? new Date(w.at.getTime() + DAY - 1) : w.at;
  }
  const byDay: Rule['byDay'] = [];
  for (const tok of (parts['BYDAY'] ?? '').split(',')) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok.trim().toUpperCase());
    if (m) byDay.push({ n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS.indexOf(m[2] as (typeof WEEKDAYS)[number]) });
  }
  const byMonthDay = (parts['BYMONTHDAY'] ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x !== 0 && Math.abs(x) <= 31);
  return { freq, interval, count, until, byDay, byMonthDay };
}

const daysInMonth = (y: number, mo: number): number => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const weekdayOf = (y: number, mo: number, d: number): number => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

interface YMD {
  y: number;
  mo: number;
  d: number;
}

const addDays = (p: YMD, n: number): YMD => {
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

const cmpYmd = (a: YMD, b: YMD): number => a.y - b.y || a.mo - b.mo || a.d - b.d;

/** Datas candidatas do período `k` (0 = período do início), em ordem. */
function candidates(rule: Rule, first: YMD, k: number): YMD[] {
  const step = k * rule.interval;
  if (rule.freq === 'DAILY') {
    const p = addDays(first, step);
    if (rule.byDay.length > 0 && !rule.byDay.some((b) => b.wd === weekdayOf(p.y, p.mo, p.d))) return [];
    return [p];
  }
  if (rule.freq === 'WEEKLY') {
    const wds = rule.byDay.length > 0 ? [...new Set(rule.byDay.map((b) => b.wd))] : [weekdayOf(first.y, first.mo, first.d)];
    // Semana de segunda a domingo (o padrão do iCal); o período 0 é a semana do início.
    const mondayOffset = (weekdayOf(first.y, first.mo, first.d) + 6) % 7;
    const monday = addDays(first, -mondayOffset + step * 7);
    return wds
      .map((wd) => addDays(monday, (wd + 6) % 7))
      .sort(cmpYmd);
  }
  if (rule.freq === 'MONTHLY') {
    const total = first.y * 12 + (first.mo - 1) + step;
    const y = Math.floor(total / 12);
    const mo = (total % 12) + 1;
    const dim = daysInMonth(y, mo);
    const out: YMD[] = [];
    if (rule.byMonthDay.length > 0) {
      for (const bd of rule.byMonthDay) {
        const d = bd > 0 ? bd : dim + bd + 1;
        if (d >= 1 && d <= dim) out.push({ y, mo, d });
      }
    } else if (rule.byDay.length > 0) {
      for (const b of rule.byDay) {
        const all: number[] = [];
        for (let d = 1; d <= dim; d += 1) if (weekdayOf(y, mo, d) === b.wd) all.push(d);
        if (b.n === 0) for (const d of all) out.push({ y, mo, d });
        else {
          const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
          if (d !== undefined) out.push({ y, mo, d });
        }
      }
    } else if (first.d <= dim) out.push({ y, mo, d: first.d });
    return out.sort(cmpYmd);
  }
  const y = first.y + step;
  return first.d <= daysInMonth(y, first.mo) ? [{ y, mo: first.mo, d: first.d }] : [];
}

interface RawEvent {
  uid: string;
  dtstart: When;
  dtend: When | undefined;
  durationMs: number | undefined;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  cancelled: boolean;
  rrule: string | undefined;
  exdates: Set<number>;
  recurrenceId: When | undefined;
}

function endOf(e: RawEvent, start: Date): Date {
  if (e.dtend) return new Date(start.getTime() + Math.max(0, e.dtend.at.getTime() - e.dtstart.at.getTime()));
  if (e.durationMs !== undefined) return new Date(start.getTime() + Math.max(0, e.durationMs));
  return new Date(start.getTime() + 3 * 3_600_000);
}

export function parseIcs(text: string, opts: IcsParseOptions): IcsParseResult {
  const defaultTz = opts.defaultTimeZone && isKnownTimeZone(opts.defaultTimeZone) ? opts.defaultTimeZone : ICS_DEFAULT_TIME_ZONE;
  const max = opts.max ?? 500;
  const lines = unfold(text);
  const isCalendar = lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR');
  const raws: RawEvent[] = [];
  let skippedAllDay = 0;

  let inEvent = false;
  let props: Prop[] = [];
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      props = [];
      continue;
    }
    if (upper === 'END:VEVENT') {
      inEvent = false;
      const get = (n: string) => props.find((p) => p.name === n);
      const start = get('DTSTART');
      const dtstart = start ? parseWhen(start, defaultTz) : undefined;
      if (!dtstart) continue;
      if (dtstart.allDay) {
        skippedAllDay += 1;
        continue;
      }
      const endProp = get('DTEND');
      const durProp = get('DURATION');
      const rid = get('RECURRENCE-ID');
      const exdates = new Set<number>();
      for (const p of props.filter((x) => x.name === 'EXDATE')) {
        for (const v of p.value.split(',')) {
          const w = parseWhen({ ...p, value: v }, defaultTz);
          if (w && !w.allDay) exdates.add(w.at.getTime());
        }
      }
      const text = (n: string): string | null => {
        const p = get(n);
        const v = p ? unescapeText(p.value).trim() : '';
        return v === '' ? null : v;
      };
      raws.push({
        uid: get('UID')?.value.trim() || `${dtstart.at.toISOString()}|${text('SUMMARY') ?? ''}`,
        dtstart,
        dtend: endProp ? parseWhen(endProp, defaultTz) : undefined,
        durationMs: durProp ? parseDuration(durProp.value) : undefined,
        summary: text('SUMMARY') ?? '',
        description: text('DESCRIPTION'),
        location: text('LOCATION'),
        url: text('URL'),
        cancelled: (get('STATUS')?.value.trim().toUpperCase() ?? '') === 'CANCELLED',
        rrule: get('RRULE')?.value,
        exdates,
        recurrenceId: rid ? parseWhen(rid, defaultTz) : undefined,
      });
      continue;
    }
    if (!inEvent) continue;
    const p = parseLine(line);
    if (p) props.push(p);
  }

  const fromMs = opts.from.getTime();
  const toMs = opts.to.getTime();
  const overrides = new Map<string, RawEvent>();
  for (const e of raws) if (e.recurrenceId) overrides.set(`${e.uid}|${e.recurrenceId.at.getTime()}`, e);

  const out: IcsOccurrence[] = [];
  const push = (e: RawEvent, start: Date, originalStart: Date): void => {
    if (e.cancelled || start.getTime() < fromMs || start.getTime() > toMs) return;
    out.push({ uid: e.uid, start, end: endOf(e, start), originalStart, summary: e.summary, description: e.description, location: e.location, url: e.url });
  };

  for (const e of raws) {
    if (out.length >= max) break;
    if (e.recurrenceId) {
      // Uma ocorrência alterada: vale se a série original existe; senão, vale como evento avulso.
      push(e, e.dtstart.at, e.recurrenceId.at);
      continue;
    }
    const rule = e.rrule ? parseRule(e.rrule, defaultTz, e.dtstart.tz) : undefined;
    if (!rule) {
      push(e, e.dtstart.at, e.dtstart.at);
      continue;
    }
    const first: YMD = { y: e.dtstart.wall.y, mo: e.dtstart.wall.mo, d: e.dtstart.wall.d };
    const { h, mi, s } = e.dtstart.wall;
    let produced = 0;
    let steps = 0;
    let finished = false;
    for (let k = 0; !finished && steps < MAX_STEPS; k += 1, steps += 1) {
      for (const day of candidates(rule, first, k)) {
        if (cmpYmd(day, first) < 0) continue;
        const at = e.dtstart.tz === 'UTC' ? new Date(Date.UTC(day.y, day.mo - 1, day.d, h, mi, s)) : wallToUtc(e.dtstart.tz, day.y, day.mo, day.d, h, mi, s);
        if (rule.until && at.getTime() > rule.until.getTime()) {
          finished = true;
          break;
        }
        if (rule.count !== undefined && produced >= rule.count) {
          finished = true;
          break;
        }
        produced += 1;
        if (at.getTime() > toMs) {
          finished = true;
          break;
        }
        if (e.exdates.has(at.getTime())) continue;
        const over = overrides.get(`${e.uid}|${at.getTime()}`);
        if (over) continue; // a ocorrência alterada é lida como evento próprio
        push(e, at, at);
        if (out.length >= max) {
          finished = true;
          break;
        }
      }
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime() || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  return { events: out.slice(0, max), skippedAllDay, isCalendar };
}

/** Texto simples a partir de uma descrição que pode vir com HTML (o Google Agenda manda <br>, <a>, etc.). */
export function plainText(input: string): string {
  return input
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
