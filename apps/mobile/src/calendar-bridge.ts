/**
 * Ponte `window.AskouTCalendar`: grava o arquivo de agenda (.ics) do evento e abre o menu de compartilhar do iPhone/Android,
 * que oferece "Adicionar à Agenda". Não pede permissão de agenda (a pessoa é quem escolhe e confirma na própria agenda).
 */

export interface CalendarDeps {
  /** Grava o texto em arquivo temporário e devolve o endereço (`file://`) dele. */
  writeFile(o: { path: string; data: string }): Promise<{ uri: string }>;
  share(o: { title: string; url: string; dialogTitle: string }): Promise<unknown>;
}

export function createCalendarBridge(deps: CalendarDeps) {
  return {
    async addEvent(o: { filename: string; ics: string }): Promise<void> {
      if (!/^[A-Za-z0-9._-]{1,80}\.ics$/.test(o.filename)) throw new Error('Nome de arquivo inválido.');
      if (!o.ics.startsWith('BEGIN:VCALENDAR')) throw new Error('Arquivo de agenda inválido.');
      const { uri } = await deps.writeFile({ path: o.filename, data: o.ics });
      try {
        await deps.share({ title: 'Adicionar à agenda', url: uri, dialogTitle: 'Adicionar à agenda' });
      } catch (e) {
        // Fechar o menu sem escolher lança erro em alguns aparelhos: não é falha.
        const text = e instanceof Error ? e.message : String(e);
        if (/cancel|dismiss/i.test(text)) return;
        throw e;
      }
    },
  };
}
