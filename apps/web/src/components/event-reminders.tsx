import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './agenda.tsx';
import { Button, ErrorState, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';
import type { EventReminderOption } from '../lib/types.ts';

/** Na ordem em que acontecem: do mais cedo ao mais perto do começo. */
export const REMINDER_OPTIONS: { id: EventReminderOption; label: string; short: string }[] = [
  { id: '1d', label: t('1 dia antes'), short: t('1 dia antes') },
  { id: 'manha', label: t('De manhã no dia ("É hoje!")'), short: t('"É hoje!" de manhã') },
  { id: '2h', label: t('2 h antes'), short: t('2 h antes') },
  { id: '1h', label: t('1 h antes'), short: t('1 h antes') },
  { id: '30m', label: t('30 min antes'), short: t('30 min antes') },
  { id: '15m', label: t('15 min antes'), short: t('15 min antes') },
];

/** Liga ou desliga um lembrete da lista, mantendo a ordem. Exportado para os testes. */
export function toggleReminder(list: readonly EventReminderOption[], option: EventReminderOption): EventReminderOption[] {
  const next = list.includes(option) ? list.filter((o) => o !== option) : [...list, option];
  return REMINDER_OPTIONS.map((o) => o.id).filter((id) => next.includes(id));
}

/** "\"É hoje!\" de manhã e 30 min antes", ou "nenhum lembrete". Exportado para os testes. */
export function remindersSummary(list: readonly EventReminderOption[]): string {
  const names = REMINDER_OPTIONS.filter((o) => list.includes(o.id)).map((o) => o.short);
  if (names.length === 0) return t('Nenhum lembrete');
  if (names.length === 1) return names[0]!;
  return t('{list} e {last}', { list: names.slice(0, -1).join(', '), last: names[names.length - 1]! });
}

/** Fuso do aparelho, para o "É hoje!" sair de manhã na hora certa. */
function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function ReminderChips({ value, busy, labelledBy, onToggle }: { value: readonly EventReminderOption[]; busy: boolean; labelledBy: string; onToggle: (option: EventReminderOption) => void }) {
  return (
    <div className="chips soundpicker" role="group" aria-labelledby={labelledBy}>
      {REMINDER_OPTIONS.map((option) => (
        <button type="button" key={option.id} className="chip" aria-pressed={value.includes(option.id)} disabled={busy} onClick={() => onToggle(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Configuração > Notificações: quais lembretes chegam antes dos eventos que você confirmou. Cada toque já salva. */
export function EventReminderCard() {
  const current = useAsync(() => api.eventReminderSettings(), []);
  const [override, setOverride] = useState<{ reminders: EventReminderOption[]; custom: boolean } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const value = override ?? current.data;

  async function save(reminders: EventReminderOption[] | null) {
    if (!value || busy) return;
    setOverride(reminders === null ? value : { reminders, custom: true });
    setProblem(undefined);
    setBusy(true);
    try {
      setOverride(await api.setEventReminderSettings(reminders, deviceTimeZone()));
    } catch (failure) {
      setOverride(value);
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  if (current.error) return <ErrorState message={current.error.message} onRetry={current.reload} />;
  if (!value) return <Loading shape="toggles" />;
  return (
    <>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h3 className="setting__title" id="event-reminders">
            {t('Antes dos eventos que você vai')}
          </h3>
          <p className="setting__help">
            {value.custom
              ? t('Escolha quantos lembretes quer e com quanto tempo antes. Dá para mudar em cada evento também.')
              : t('Padrão: "É hoje!" de manhã no dia e outro 30 min antes. Toque para escolher outros; dá para mudar em cada evento também.')}
          </p>
          <ReminderChips value={value.reminders} busy={busy} labelledBy="event-reminders" onToggle={(o) => void save(toggleReminder(value.reminders, o))} />
          {value.custom ? (
            <p className="setting__help">
              <button type="button" className="linkbtn" disabled={busy} onClick={() => void save(null)}>
                {t('Voltar ao padrão')}
              </button>
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

/** Folha do evento: lembretes só deste evento, no lugar da escolha geral. */
export function EventReminderSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const current = useAsync(() => api.eventReminders(eventId), [eventId]);
  const [override, setOverride] = useState<{ reminders: EventReminderOption[]; custom: boolean; general: EventReminderOption[] } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const value = override ?? current.data;

  async function save(reminders: EventReminderOption[] | null) {
    if (!value || busy) return;
    setOverride(reminders === null ? { ...value, reminders: value.general, custom: false } : { ...value, reminders, custom: true });
    setProblem(undefined);
    setBusy(true);
    try {
      setOverride(await api.setEventReminders(eventId, reminders));
    } catch (failure) {
      setOverride(value);
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <Sheet title={t('Lembretes deste evento')} onClose={onClose}>
      {current.error ? (
        <ErrorState message={current.error.message} onRetry={current.reload} />
      ) : !value ? (
        <Loading shape="toggles" />
      ) : (
        <div className="stack">
          <p className="muted" id="event-reminders-sheet">
            {value.custom ? t('Só para este evento. Toque para ligar ou desligar.') : t('Seguindo sua escolha geral: {list}. Toque para mudar só neste evento.', { list: remindersSummary(value.general) })}
          </p>
          <ReminderChips value={value.reminders} busy={busy} labelledBy="event-reminders-sheet" onToggle={(o) => void save(toggleReminder(value.reminders, o))} />
          {problem ? <Notice tone="error">{problem}</Notice> : null}
          <div className="sheetactions">
            {value.custom ? (
              <Button full variant="secondary" loading={busy} onClick={() => void save(null)}>
                {t('Usar minha escolha geral')}
              </Button>
            ) : null}
            <Button full onClick={onClose}>
              {t('Pronto')}
            </Button>
          </div>
        </div>
      )}
    </Sheet>,
    document.body,
  );
}
