/** Agendas externas que a pessoa pode ligar à agenda do AskouT. */
export type CalendarProvider = 'PHONE' | 'GOOGLE' | 'OUTLOOK';

export const CALENDAR_PROVIDERS: readonly { id: CalendarProvider; name: string; hint: string }[] = [
  { id: 'PHONE', name: 'Agenda do celular', hint: 'Compromissos do calendário do aparelho' },
  { id: 'GOOGLE', name: 'Google Agenda', hint: 'Compromissos da sua conta Google' },
  { id: 'OUTLOOK', name: 'Outlook', hint: 'Compromissos da sua conta Microsoft' },
];

const IDS: readonly string[] = CALENDAR_PROVIDERS.map((p) => p.id);

/** Lê o que foi guardado, ignorando lixo e repetidos. */
export function parseSynced(raw: string | null): CalendarProvider[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return CALENDAR_PROVIDERS.map((p) => p.id).filter((id) => value.includes(id));
  } catch {
    return [];
  }
}

/** Soma as escolhidas às já sincronizadas, na ordem de exibição. */
export function addSynced(current: readonly CalendarProvider[], picked: readonly CalendarProvider[]): CalendarProvider[] {
  return CALENDAR_PROVIDERS.map((p) => p.id).filter((id) => current.includes(id) || picked.includes(id));
}

export function removeSynced(current: readonly CalendarProvider[], id: CalendarProvider): CalendarProvider[] {
  return current.filter((x) => x !== id);
}

export function isProvider(value: string): value is CalendarProvider {
  return IDS.includes(value);
}
