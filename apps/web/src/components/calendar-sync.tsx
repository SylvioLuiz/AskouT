import { useEffect, useState } from 'react';
import { Button, Confirm, Loading, Notice } from './ui.tsx';
import { Sheet } from './agenda.tsx';
import { CalendarLogo } from './calendar-logos.tsx';
import { CheckIcon } from './icons.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { calendarOptions, deviceCalendarBridge, deviceResyncDue, groupByAccount, logoForAccount, logoForConnection, syncWindow } from '../lib/calendar-sync.ts';
import type { CalendarConnection, CalendarOption, CalendarOverview, DeviceCalendar } from '../lib/calendar-sync.ts';
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

function messageOf(failure: unknown, fallback: string): string {
  if (failure instanceof Error && !('code' in failure)) return failure.message || fallback;
  return toApiError(failure).message;
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

/**
 * "Sincronizar agendas", no jeito dos apps de agenda: uma lista com o ícone de cada app (celular, Google, Outlook, iCloud),
 * as que a pessoa provavelmente tem primeiro, e "Conectar" que liga direto (permissão do aparelho ou login na conta).
 */
export function CalendarSyncSheet({ onClose, onChange, notice }: { onClose: () => void; onChange?: (overview: CalendarOverview) => void; notice?: { tone: 'ok' | 'error'; text: string } }) {
  const overview = useAsync(() => api.calendarOverview(), []);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>(notice);
  const [busyId, setBusyId] = useState<string | undefined>();
  const inApp = deviceCalendarBridge() !== undefined;

  useEffect(() => {
    if (overview.data) onChange?.(overview.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview.data]);

  // Voltando do navegador (login do Google/Microsoft pelo app): recarrega para mostrar a conta ligada.
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
      setMessage({ tone: 'error', text: messageOf(failure, t('Não foi possível ligar a agenda.')) });
    } finally {
      setBusyId(undefined);
    }
  }

  async function connectAccount(via: 'google' | 'microsoft') {
    setBusyId(via);
    setMessage(undefined);
    try {
      const from = inApp ? 'app' : 'web';
      const { url } = via === 'google' ? await api.startGoogleCalendar(from) : await api.startMicrosoftCalendar(from);
      // No app abre o navegador do celular (Google e Microsoft não deixam entrar dentro do app); no site, volta para /agenda.
      window.location.assign(url);
    } catch (failure) {
      setMessage({ tone: 'error', text: messageOf(failure, t('Não foi possível ligar a agenda.')) });
    } finally {
      setBusyId(undefined);
    }
  }

  function connect(option: CalendarOption) {
    if (!option.available) return;
    if (option.via === 'device') setPicking(true);
    else void connectAccount(option.via);
  }

  if (picking) {
    return (
      <Sheet title={t('Agenda do celular')} onClose={onClose}>
        <DevicePicker
          current={overview.data?.connections.find((c) => c.provider === 'DEVICE')}
          onBack={() => setPicking(false)}
          onSaved={() => {
            setPicking(false);
            setMessage({ tone: 'ok', text: t('Agenda do celular sincronizada.') });
            overview.reload();
          }}
        />
      </Sheet>
    );
  }

  const data = overview.data;
  const options = data ? calendarOptions(data, inApp) : [];
  const detected = options.filter((o) => o.detected && o.available);
  const others = options.filter((o) => !(o.detected && o.available));

  return (
    <Sheet title={t('Sincronizar agendas')} onClose={onClose}>
      <p className="muted">{t('Conecte suas agendas: os compromissos aparecem como "ocupado" na sua agenda do AskouT. Títulos e detalhes não saem da sua agenda.')}</p>
      {message ? (
        <Notice tone={message.tone}>
          {message.tone === 'ok' ? <span className="calsync__check" aria-hidden="true"><CheckIcon /></span> : null}
          {message.text}
        </Notice>
      ) : null}
      {overview.loading && !data ? <Loading shape="lines" /> : null}
      {overview.error ? <Notice tone="error">{overview.error.message}</Notice> : null}

      {data && data.connections.length > 0 ? (
        <section className="calsync__section">
          <h3 className="calsync__heading">{t('Conectadas')}</h3>
          <ul className="calsync__list">
            {data.connections.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                busy={busyId === c.id}
                onSync={() => (c.provider === 'DEVICE' ? setPicking(true) : void run(c.id, () => api.syncMyCalendar(c.id), t('Agenda atualizada.')))}
                onReconnect={c.provider === 'GOOGLE' ? () => void connectAccount('google') : c.provider === 'MICROSOFT' ? () => void connectAccount('microsoft') : undefined}
                onToggle={(calendarIds) => void run(c.id, () => api.setCalendarSelection(c.id, calendarIds))}
                onRemove={() => void run(c.id, () => api.removeMyCalendar(c.id), t('{label} desconectada.', { label: c.label }))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {detected.length > 0 ? (
        <section className="calsync__section">
          <h3 className="calsync__heading">{t('Encontramos para você')}</h3>
          <OptionList options={detected} busyId={busyId} onConnect={connect} />
        </section>
      ) : null}
      {others.length > 0 ? (
        <section className="calsync__section">
          <h3 className="calsync__heading">{detected.length > 0 || (data?.connections.length ?? 0) > 0 ? t('Outras agendas') : t('Escolha uma agenda')}</h3>
          <OptionList options={others} busyId={busyId} onConnect={connect} />
        </section>
      ) : null}
      {data && !inApp ? <p className="muted calsync__note">{t('No app do AskouT dá para conectar a agenda do celular, com iCloud e todas as contas dele.')}</p> : null}
    </Sheet>
  );
}

function OptionList({ options, busyId, onConnect }: { options: CalendarOption[]; busyId: string | undefined; onConnect: (o: CalendarOption) => void }) {
  return (
    <ul className="calsync__list">
      {options.map((o) => (
        <li key={o.kind}>
          <button type="button" className="calsync__row-btn" disabled={!o.available || busyId === o.via} onClick={() => onConnect(o)} aria-label={o.available ? t('Conectar {name}', { name: o.name }) : t('{name} em breve', { name: o.name })}>
            <CalendarLogo kind={o.logo} />
            <span className="calsync__text">
              <strong>{o.name}</strong>
              <span className="muted">{o.available ? o.hint : t('Em breve')}</span>
            </span>
            {o.available ? <span className="calsync__cta">{busyId === o.via ? t('Abrindo…') : t('Conectar')}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConnectionItem({ connection: c, busy, onSync, onReconnect, onToggle, onRemove }: { connection: CalendarConnection; busy: boolean; onSync: () => void; onReconnect: (() => void) | undefined; onToggle: (ids: string[]) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const revoked = c.status !== 'ACTIVE';
  const selected = c.calendars.filter((x) => x.selected);
  const canChoose = (c.provider === 'GOOGLE' || c.provider === 'MICROSOFT') && c.calendars.length > 0 && !revoked;
  return (
    <li className={`calsync__conn${revoked ? ' calsync__conn--warn' : ''}`}>
      <div className="calsync__conn-head">
        <CalendarLogo kind={logoForConnection(c)} />
        <span className="calsync__text">
          <strong>{c.label}</strong>
          <span className="muted">
            {revoked ? t('Precisa conectar de novo') : c.calendars.length > 0 ? t('{n} de {total} agendas · {when}', { n: selected.length, total: c.calendars.length, when: syncedAgo(c.lastSyncAt) }) : syncedAgo(c.lastSyncAt)}
          </span>
        </span>
        {revoked ? <span className="calsync__badge calsync__badge--warn">{t('Desconectada')}</span> : <span className="calsync__ok" aria-label={t('Sincronizado')}>✓</span>}
      </div>
      {c.lastError ? <Notice tone="error">{c.lastError}</Notice> : null}
      {open && canChoose ? (
        <fieldset className="calsync__calendars">
          <legend className="muted">{t('Agendas que entram')}</legend>
          {c.calendars.map((x) => (
            <label key={x.id} className="calsync__check">
              <input type="checkbox" checked={x.selected} disabled={busy} onChange={(e) => onToggle(c.calendars.filter((y) => (y.id === x.id ? e.target.checked : y.selected)).map((y) => y.id))} />
              {x.color ? <span className="calsync__dot" style={{ background: x.color }} aria-hidden="true" /> : null}
              <span>{x.name}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="calsync__actions">
        {revoked && onReconnect ? (
          <Button small onClick={onReconnect}>
            {t('Conectar de novo')}
          </Button>
        ) : c.provider === 'DEVICE' ? (
          <Button small variant="quiet" onClick={onSync}>
            {t('Escolher agendas')}
          </Button>
        ) : c.provider === 'ICS' ? null : (
          <Button small variant="quiet" loading={busy} onClick={onSync}>
            {t('Atualizar agora')}
          </Button>
        )}
        {canChoose ? (
          <Button small variant="quiet" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? t('Fechar agendas') : t('Escolher agendas')}
          </Button>
        ) : null}
        <Button small variant="quiet" disabled={busy || asking} onClick={() => setAsking(true)} aria-label={t('Desconectar {name}', { name: c.label })}>
          {t('Desconectar')}
        </Button>
      </div>
      {asking ? (
        <Confirm
          danger
          question={t('Desconectar {name}? Os horários importados dela saem da sua Agenda.', { name: c.label })}
          confirmLabel={t('Desconectar')}
          busy={busy}
          onConfirm={() => { setAsking(false); onRemove(); }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </li>
  );
}

/** Lista as agendas do aparelho por conta (com o ícone de cada uma: Google, Outlook, iCloud...) para escolher quais entram. */
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
      .catch((failure: unknown) => setError(messageOf(failure, t('Não foi possível ler a agenda do celular.'))));
  }, [current]);

  async function save() {
    if (!calendars) return;
    setSaving(true);
    setError(undefined);
    try {
      await pushDeviceCalendars(calendars.map((c) => ({ ...c, selected: chosen.has(c.id) })));
      onSaved();
    } catch (failure) {
      setError(messageOf(failure, t('Não foi possível ler a agenda do celular.')));
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
      <p className="muted">{t('Estas são as agendas das contas do seu celular. Escolha quais entram.')}</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!calendars && !error ? <Loading shape="lines" /> : null}
      {calendars && calendars.length === 0 ? <Notice>{t('Nenhuma agenda encontrada no aparelho.')}</Notice> : null}
      {calendars
        ? groupByAccount(calendars).map((group) => (
            <fieldset key={group.account} className="calsync__calendars">
              <legend className="calsync__account">
                <CalendarLogo kind={logoForAccount(group.account)} size={24} />
                <span>{group.account}</span>
              </legend>
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
      <Button full loading={saving} disabled={!calendars || chosen.size === 0} onClick={() => save()}>
        {chosen.size > 0 ? t('Sincronizar ({length})', { length: chosen.size }) : t('Sincronizar')}
      </Button>
      <Button variant="quiet" full onClick={onBack}>
        {t('Voltar')}
      </Button>
    </div>
  );
}
