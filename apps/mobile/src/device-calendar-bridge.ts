/**
 * Ponte `window.AskouTDeviceCalendar`: lê a agenda do celular (iPhone e Android), com a permissão do aparelho.
 * A agenda do aparelho já reúne as contas ligadas nele (Google, Outlook/Exchange, iCloud, Samsung...), então a pessoa
 * vê as agendas agrupadas por conta e escolhe quais entram. Só início e fim saem daqui: nunca título, local ou participantes.
 */

export interface DeviceCalendarLike {
  requestReadOnlyCalendarAccess(): Promise<{ result: string }>;
  requestFullCalendarAccess(): Promise<{ result: string }>;
  listCalendars(): Promise<{
    result: {
      id: string;
      title: string | null;
      color: string | null;
      accountName: string | null;
      ownerAccount?: string | null;
      visible?: boolean | null;
      source: { title: string; type?: unknown } | null;
    }[];
  }>;
  listEventsInRange(o: { from: number; to: number; calendarIds?: string[] }): Promise<{
    result: { calendarId: string | null; startDate: number; endDate: number; isAllDay: boolean; availability: number | null; status: string | null }[];
  }>;
}

export interface DeviceCalendar {
  id: string;
  name: string;
  /** Conta de onde vem a agenda (ex.: "ana@gmail.com", "iCloud", "Outlook"). */
  account: string | null;
  color: string | null;
}

/** EventAvailability do plugin: 1 = livre (não ocupa o horário). */
const FREE = 1;

export function createDeviceCalendarBridge(deps: { calendar: DeviceCalendarLike; platform: () => string }) {
  async function ensureAccess(): Promise<void> {
    // iPhone (iOS 17+) não tem acesso só de leitura: ler exige o acesso completo. No Android basta o de leitura.
    const { result } = deps.platform() === 'ios' ? await deps.calendar.requestFullCalendarAccess() : await deps.calendar.requestReadOnlyCalendarAccess();
    if (result !== 'granted') throw new Error('Sem permissão para ler a agenda do celular. Libere nos Ajustes do aparelho.');
  }

  return {
    /** Pede a permissão (só na primeira vez aparece a pergunta) e lista as agendas, agrupáveis por conta. */
    async listCalendars(): Promise<DeviceCalendar[]> {
      await ensureAccess();
      const { result } = await deps.calendar.listCalendars();
      return result
        .filter((c) => c.visible !== false)
        .map((c) => ({
          id: c.id,
          name: c.title?.trim() || 'Agenda',
          account: c.accountName?.trim() || c.source?.title?.trim() || c.ownerAccount?.trim() || null,
          color: c.color,
        }))
        .sort((a, b) => (a.account ?? '').localeCompare(b.account ?? '') || a.name.localeCompare(b.name));
    },

    /** Horários ocupados das agendas escolhidas, em [from, to). Ignora dia inteiro, cancelados e marcados como "livre". */
    async busy(o: { calendarIds: string[]; from: string; to: string }): Promise<{ start: string; end: string }[]> {
      if (o.calendarIds.length === 0) return [];
      await ensureAccess();
      const from = Date.parse(o.from);
      const to = Date.parse(o.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new Error('Período inválido.');
      const wanted = new Set(o.calendarIds);
      const { result } = await deps.calendar.listEventsInRange({ from, to, calendarIds: o.calendarIds });
      return result
        .filter((e) => (e.calendarId === null || wanted.has(e.calendarId)) && !e.isAllDay && e.availability !== FREE && e.status !== 'canceled' && e.endDate > e.startDate)
        .map((e) => ({ start: new Date(e.startDate).toISOString(), end: new Date(e.endDate).toISOString() }));
    },
  };
}
