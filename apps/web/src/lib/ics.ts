// Arquivo de agenda (.ics, RFC 5545) de um evento, para "Adicionar à agenda".
export interface IcsEvent {
  id: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  venue?: { name: string; address: string | null } | null;
  url?: string;
}

/** Escapa texto: barra, ponto e vírgula, vírgula e quebras de linha (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Quebra linhas com mais de 75 bytes (a continuação começa com um espaço), sem cortar um caractere no meio. */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** Devolve o conteúdo do .ics, ou `null` se as datas não valem. Horário em UTC (o aparelho converte para o fuso da pessoa). */
export function buildEventIcs(event: IcsEvent, now: Date = new Date()): string | null {
  const start = new Date(event.startsAt);
  let end = new Date(event.endsAt);
  if (Number.isNaN(start.getTime())) return null;
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) end = new Date(start.getTime() + 2 * 3600_000);
  const location = event.venue ? (event.venue.address ? `${event.venue.name}, ${event.venue.address}` : event.venue.name) : '';
  const description = [event.description?.trim(), event.url].filter((x): x is string => Boolean(x)).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AskouT//Evento//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@askout.com.br`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Lembrete do evento',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

export function icsFilename(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'evento'}.ics`;
}

/** Ponte do app (`window.AskouTCalendar`, ver apps/mobile): abre o menu de compartilhar do iPhone, que tem "Adicionar à Agenda". */
export interface NativeCalendarBridge {
  addEvent(o: { filename: string; ics: string }): Promise<void>;
}

export function nativeCalendarBridge(host: unknown = typeof window === 'undefined' ? undefined : window): NativeCalendarBridge | undefined {
  const b = (host as { AskouTCalendar?: Partial<NativeCalendarBridge> } | undefined)?.AskouTCalendar;
  return b && typeof b.addEvent === 'function' ? (b as NativeCalendarBridge) : undefined;
}

/** No app, abre pelo iPhone; no navegador, baixa o arquivo (o celular/computador oferece abrir na agenda). */
export async function addToCalendar(event: IcsEvent): Promise<void> {
  const ics = buildEventIcs(event);
  if (ics === null) throw new Error('Este evento não tem data válida para a agenda.');
  const filename = icsFilename(event.title);
  const bridge = nativeCalendarBridge();
  if (bridge) {
    await bridge.addEvent({ filename, ics });
    return;
  }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
