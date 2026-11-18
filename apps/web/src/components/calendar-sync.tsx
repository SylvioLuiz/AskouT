import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Field, Loading, Notice } from './ui.tsx';
import { Sheet } from './agenda.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { calendarOptions, deviceCalendarBridge, deviceResyncDue, groupByAccount, icsHelp, syncWindow } from '../lib/calendar-sync.ts';
import type { CalendarConnection, CalendarOption, CalendarOptionKind, CalendarOverview, DeviceCalendar } from '../lib/calendar-sync.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';

const DEVICE_SYNC_KEY = 'askout.deviceCalendarSyncAt';

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: só reenvia mais vezes
  }
}

/** Lê as agendas escolhidas no aparelho e manda só os horários ocupados para a conta. */
export async function pushDeviceCalendars(calendars: { id: string; name: string; account: string | null; color: string | null; selected: boolean }[]): Promise<CalendarConnection> {
  const bridge = deviceCalendarBridge();
  if (!bridge) throw new Error(t('A agenda do celular só pode ser lida no app do AskouT.'));
  const { from, to } = syncWindow(new Date());
  const intervals = await bridge.busy({ calendarIds: calendars.filter((c) => c.selected).map((c) => c.id), from, to });
  const saved = await api.saveDeviceCalendars({ calendars, intervals });
  writeLocal(DEVICE_SYNC_KEY, new Date().toISOString());
  return saved;
}

/**
 * Ao abrir a agenda no app: se a agenda do celular está ligada, reenvia os horários (no máximo a cada 30 min),
 * já conferindo agendas novas no aparelho. Falha em silêncio (a pessoa pode ter tirado a permissão).
 */
export async function refreshDeviceCalendarsIfDue(connections: readonly CalendarConnection[]): Promise<boolean> {
  const device = connections.find((c) => c.provider === 'DEVICE');
  const bridge = deviceCalendarBridge();
  if (!device || !bridge || !deviceResyncDue(readLocal(DEVICE_SYNC_KEY), new Date())) return false;
  try {
    const onPhone = await bridge.listCalendars();
    const chosen = new Set(device.calendars.filter((c) => c.selected).map((c) => c.id));
    const calendars = onPhone.map((c) => ({ ...c, selected: chosen.has(c.id) }));
    if (!calendars.some((c) => c.selected)) return false;
    await pushDeviceCalendars(calendars);
    return true;
  } catch {
    return false;
  }
}

function syncedAgo(iso: string | null): string {
  if (!iso) return t('Ainda não sincronizada');
  return t('Atualizada {when}', { when: new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) });
}

type View = { kind: 'home' } | { kind: 'device' } | { kind: 'ics'; option: CalendarOptionKind };

/**
 * "Sincronizar agendas": mostra primeiro as agendas que a pessoa provavelmente tem (celular, conta Google do login,
 * provedor do e-mail), depois as outras opções. Cada conexão mostra as agendas dela para escolher quais entram.
 */
export function CalendarSyncSheet({ onClose, onChange, notice }: { onClose: () => void; onChange?: (overview: CalendarOverview) => void; notice?: { tone: 'ok' | 'error'; text: string } }) {
  const overview = useAsync(() => api.calendarOverview(), []);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>(notice);
  const [busyId, setBusyId] = useState<string | undefined>();
  const inApp = deviceCalendarBridge() !== undefined;

  useEffect(() => {
    if (overview.data) onChange?.(overview.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.data]);

  // Voltando do navegador (Google Agenda pelo app): recarrega para mostrar a conta ligada.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') overview.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(id: string, action: () => Promise<unknown>, ok?: string) {
    setBusyId(id);
    setMessage(undefined);
    try {
      await action();
      if (ok) setMessage({ tone: 'ok', text: ok });
      overview.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error && !('code' in failure) ? failure.message : toApiError(failure).message });
    } finally {
      setBusyId(undefined);
    }
  }

  async function connectGoogle() {
    setBusyId('google');
    setMessage(undefined);
    try {
      const { url } = await api.startGoogleCalendar(inApp ? 'app' : 'web');
      // No app abre o navegador do celular (o Google não permite login dentro do app); no site, volta para /agenda.
      window.location.assign(url);
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusyId(undefined);
    }
  }

  function choose(option: CalendarOption) {
    if (option.via === 'device') setView({ kind: 'device' });
    else if (option.via === 'google') void connectGoogle();
    else setView({ kind: 'ics', option: option.kind });
  }

  if (view.kind === 'device') {
    return (
      <Sheet title={t('Agenda do celular')} onClose={onClose}>
        <DevicePicker
          current={overview.data?.connections.find((c) => c.provider === 'DEVICE')}
          onBack={() => setView({ kind: 'home' })}
          onSaved={() => {
            setView({ kind: 'home' });
            setMessage({ tone: 'ok', text: t('Agenda do celular sincronizada.') });
            overview.reload();
          }}
        />
      </Sheet>
    );
  }

  if (view.kind === 'ics') {
    return (
      <Sheet title={t('Ligar agenda por link')} onClose={onClose}>
        <IcsForm
          option={view.option}
          onBack={() => setView({ kind: 'home' })}
          onSaved={(c) => {
            setView({ kind: 'home' });
            setMessage({ tone: 'ok', text: t('{label} sincronizada.', { label: c.label }) });
            overview.reload();
          }}
        />
      </Sheet>
    );
  }

  const data = overview.data;
  const options = data ? calendarOptions(data, inApp) : [];
  const detected = options.filter((o) => o.detected);
  const others = options.filter((o) => !o.detected);

  return (
    <Sheet title={t('Sincronizar agendas')} onClose={onClose}>
      <p className="muted">{t('Seus compromissos aparecem como "ocupado" na agenda do AskouT e na hora de achar horário com amigos. Títulos e detalhes não saem da sua agenda.')}</p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {overview.loading && !data ? <Loading /> : null}
      {overview.error ? <Notice tone="error">{overview.error.message}</Notice> : null}

      {data && data.connections.length > 0 ? (
        <section className="calsync__section">
          <h3 className="calsync__heading">{t('Ligadas')}</h3>
          <ul className="calsync">
            {data.connections.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                busy={busyId === c.id}
                onSync={() =>
                  c.provider === 'DEVICE'
                    ? setView({ kind: 'device' })
                    : void run(c.id, () => api.syncMyCalendar(c.id), t('Agenda atualizada.'))
                }
                onReconnect={c.provider === 'GOOGLE' ? () => void connectGoogle() : undefined}
                onToggle={(calendarIds) => void run(c.id, () => api.setCalendarSelection(c.id, calendarIds))}
                onRemove={() => void run(c.id, () => api.removeMyCalendar(c.id), t('{label} dessincronizada.', { label: c.label }))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {detected.length > 0 ? (
        <section className="calsync__section">
          <h3 className="calsync__heading">{t('Encontramos para você')}</h3>
          <OptionList options={detected} busyId={busyId} onChoose={choose} />
        </section>
      ) : null}
      {others.length > 0 ? (
        <section className="calsync__section">
          <h3 className="calsync__heading">{detected.length > 0 ? t('Outras agendas') : t('Escolha de onde trazer seus compromissos')}</h3>
          <OptionList options={others} busyId={busyId} onChoose={choose} />
        </section>
      ) : null}
      {data && !inApp ? <p className="muted calsync__note">{t('No app do AskouT dá para ligar direto a agenda do celular, com todas as contas dele.')}</p> : null}
    </Sheet>
  );
}

function OptionList({ options, busyId, onChoose }: { options: CalendarOption[]; busyId: string | undefined; onChoose: (o: CalendarOption) => void }) {
  return (
    <ul className="calsync">
      {options.map((o) => (
        <li key={o.kind} className="calsync__item">
          <div className="calsync__text">
            <strong>{o.name}</strong>
            <span className="muted">{o.hint}</span>
          </div>
          <Button small variant="secondary" loading={busyId === 'google' && o.via === 'google'} onClick={() => onChoose(o)} aria-label={t('Ligar {name}', { name: o.name })}>
            {t('Ligar')}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function ConnectionItem({ connection: c, busy, onSync, onReconnect, onToggle, onRemove }: { connection: CalendarConnection; busy: boolean; onSync: () => void; onReconnect: (() => void) | undefined; onToggle: (ids: string[]) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const revoked = c.status !== 'ACTIVE';
  const selected = c.calendars.filter((x) => x.selected);
  return (
    <li className={`calsync__item calsync__item--col${revoked ? ' calsync__item--warn' : ' calsync__item--on'}`}>
      <div className="calsync__row">
        <div className="calsync__text">
          <strong>{c.label}</strong>
          <span className="muted">
            {revoked ? t('Precisa ligar de novo') : c.calendars.length > 0 ? t('{n} de {total} agendas · {when}', { n: selected.length, total: c.calendars.length, when: syncedAgo(c.lastSyncAt) }) : syncedAgo(c.lastSyncAt)}
          </span>
        </div>
        <span className={`calsync__badge${revoked ? ' calsync__badge--warn' : ''}`}>{revoked ? t('Desligada') : <><span aria-hidden="true">✓</span> {t('Sincronizado')}</>}</span>
      </div>
      {c.lastError ? <Notice tone="error">{c.lastError}</Notice> : null}
      {open && c.provider === 'GOOGLE' && c.calendars.length > 0 ? (
        <fieldset className="calsync__calendars">
          <legend className="muted">{t('Agendas que entram')}</legend>
          {c.calendars.map((x) => (
            <label key={x.id} className="calsync__check">
              <input
                type="checkbox"
                checked={x.selected}
                disabled={busy}
                onChange={(e) => onToggle(c.calendars.filter((y) => (y.id === x.id ? e.target.checked : y.selected)).map((y) => y.id))}
              />
              {x.color ? <span className="calsync__dot" style={{ background: x.color }} aria-hidden="true" /> : null}
              <span>{x.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="calsync__actions">
        {revoked && onReconnect ? (
          <Button small onClick={onReconnect}>
            {t('Ligar de novo')}
          </Button>
        ) : (
          <Button small variant="quiet" loading={busy} onClick={onSync}>
            {c.provider === 'DEVICE' ? t('Escolher agendas') : t('Atualizar agora')}
          </Button>
        )}
        {c.provider === 'GOOGLE' && c.calendars.length > 0 && !revoked ? (
          <Button small variant="quiet" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('Fechar agendas') : t('Escolher agendas')}
          </Button>
        ) : null}
        <Button small variant="quiet" disabled={busy} onClick={onRemove} aria-label={t('Dessincronizar {name}', { name: c.label })}>
          {t('Dessincronizar')}
        </Button>
      </div>
    </li>
  );
}

/** Lista as agendas do aparelho por conta (Google, Outlook, iCloud...) para a pessoa escolher quais entram. */
function DevicePicker({ current, onBack, onSaved }: { current: CalendarConnection | undefined; onBack: () => void; onSaved: () => void }) {
  const [calendars, setCalendars] = useState<DeviceCalendar[] | undefined>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const bridge = deviceCalendarBridge();
    if (!bridge) {
      setError(t('A agenda do celular só pode ser lida no app do AskouT.'));
      return;
    }
    bridge
      .listCalendars()
      .then((list) => {
        setCalendars(list);
        const before = new Set(current?.calendars.filter((c) => c.selected).map((c) => c.id) ?? []);
        // Primeira vez: já vêm todas marcadas (como nos apps de agenda); depois vale o que a pessoa escolheu.
        setChosen(before.size > 0 ? before : new Set(list.map((c) => c.id)));
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t('Não foi possível ler a agenda do celular.')));
  }, [current]);

  async function save() {
    if (!calendars) return;
    setSaving(true);
    setError(undefined);
    try {
      await pushDeviceCalendars(calendars.map((c) => ({ ...c, selected: chosen.has(c.id) })));
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error && !('code' in failure) ? failure.message : toApiError(failure).message);
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <p className="muted">{t('Estas são as agendas das contas ligadas no seu celular. Escolha quais entram.')}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!calendars && !error ? <Loading /> : null}
      {calendars && calendars.length === 0 ? <Notice>{t('Nenhuma agenda encontrada no aparelho.')}</Notice> : null}
      {calendars
        ? groupByAccount(calendars).map((group) => (
            <fieldset key={group.account} className="calsync__calendars">
              <legend className="calsync__account">{group.account}</legend>
              {group.items.map((c) => (
                <label key={c.id} className="calsync__check">
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
                  {c.color ? <span className="calsync__dot" style={{ background: c.color }} aria-hidden="true" /> : null}
                  <span>{c.name}</span>
                </label>
              ))}
            </fieldset>
          ))
        : null}
      <Button full loading={saving} disabled={!calendars || chosen.size === 0} onClick={() => void save()}>
        {chosen.size > 0 ? t('Sincronizar ({length})', { length: chosen.size }) : t('Sincronizar')}
      </Button>
      <Button variant="quiet" full onClick={onBack}>
        {t('Voltar')}
      </Button>
    </div>
  );
}

function IcsForm({ option, onBack, onSaved }: { option: CalendarOptionKind; onBack: () => void; onSaved: (c: CalendarConnection) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const name = option === 'GOOGLE' ? t('Google Agenda') : option === 'OUTLOOK' ? t('Outlook') : option === 'ICLOUD' ? t('iCloud') : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await api.addIcsCalendar({ url: url.trim(), ...(name ? { label: name } : {}) }));
    } catch (failure) {
      const e = toApiError(failure);
      setError(e.fields['url'] ?? e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form form--flat" onSubmit={submit} noValidate>
      {name ? <h3 className="form__title">{name}</h3> : null}
      <ol className="calsync__steps">
        {icsHelp(option).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <Field label={t('Link da agenda')} value={url} onChange={setUrl} error={error} inputMode="url" placeholder="webcal://… ou https://….ics" autoFocus />
      <p className="muted calsync__note">{t('O link fica guardado cifrado e é relido a cada 30 minutos. Só os horários ocupados entram.')}</p>
      <Button type="submit" full loading={saving} disabled={url.trim() === ''}>
        {t('Ligar agenda')}
      </Button>
      <Button variant="quiet" full onClick={onBack}>
        {t('Voltar')}
      </Button>
    </form>
  );
}
