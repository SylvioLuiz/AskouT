/**
 * Ponte `window.AskouTCalendar`: "Adicionar à agenda" abre a tela nativa de novo evento da agenda do aparelho
 * (iPhone: editor do Calendário; Android: o app de agenda padrão), já preenchida. Não pede permissão de agenda:
 * a própria tela do sistema grava o evento quando a pessoa confirma.
 * Se a tela não abrir (ex.: Android sem app de agenda) ou o site for antigo e não mandar os campos, cai no plano B:
 * grava o arquivo .ics e abre o menu de compartilhar.
 */

export interface CalendarEventFields {
  title: string;
  /** Início e fim em ISO 8601. */
  startsAt: string;
  endsAt: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface CalendarPromptLike {
  createEventWithPrompt(o: {
    title: string;
    startDate: number;
    endDate: number;
    location?: string;
    description?: string;
    url?: string;
    alerts?: number[];
  }): Promise<unknown>;
}

export interface CalendarDeps {
  /** Plugin de agenda (tela nativa de novo evento). Sem ele, só o plano B (.ics). */
  calendar?: CalendarPromptLike;
  /** Grava o texto em arquivo temporário e devolve o endereço (`file://`) dele. */
  writeFile(o: { path: string; data: string }): Promise<{ uri: string }>;
  share(o: { title: string; url: string; dialogTitle: string }): Promise<unknown>;
}

const isCancel = (e: unknown): boolean => /cancel|dismiss/i.test(e instanceof Error ? e.message : String(e));

export function createCalendarBridge(deps: CalendarDeps) {
  async function openNative(event: CalendarEventFields): Promise<boolean> {
    if (!deps.calendar) return false;
    const startDate = Date.parse(event.startsAt);
    let endDate = Date.parse(event.endsAt);
    if (!event.title?.trim() || !Number.isFinite(startDate)) return false;
    if (!Number.isFinite(endDate) || endDate <= startDate) endDate = startDate + 2 * 3600_000;
    try {
      await deps.calendar.createEventWithPrompt({
        title: event.title.trim(),
        startDate,
        endDate,
        ...(event.location?.trim() ? { location: event.location.trim() } : {}),
        ...(event.description?.trim() ? { description: event.description.trim() } : {}),
        ...(event.url ? { url: event.url } : {}),
        alerts: [-60],
      });
      return true;
    } catch (e) {
      // Fechar a tela sem salvar não é falha; qualquer outro erro tenta o .ics.
      return isCancel(e);
    }
  }

  async function shareIcs(o: { filename: string; ics: string }): Promise<void> {
    if (!/^[A-Za-z0-9._-]{1,80}\.ics$/.test(o.filename)) throw new Error('Nome de arquivo inválido.');
    if (!o.ics.startsWith('BEGIN:VCALENDAR')) throw new Error('Arquivo de agenda inválido.');
    const { uri } = await deps.writeFile({ path: o.filename, data: o.ics });
    try {
      await deps.share({ title: 'Adicionar à agenda', url: uri, dialogTitle: 'Adicionar à agenda' });
    } catch (e) {
      // Fechar o menu sem escolher lança erro em alguns aparelhos: não é falha.
      if (isCancel(e)) return;
      throw e;
    }
  }

  return {
    async addEvent(o: { filename: string; ics: string; event?: CalendarEventFields }): Promise<void> {
      if (o.event && (await openNative(o.event))) return;
      await shareIcs(o);
    },
  };
}
