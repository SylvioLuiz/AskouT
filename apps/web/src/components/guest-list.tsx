import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { GUEST_LIST_COMPANIONS_MAX, guestListAction, guestListRules, parseGuestListForm, saveCsv } from '../lib/guest-list.ts';
import type { GuestListForm } from '../lib/guest-list.ts';
import { t } from '../lib/i18n/index.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import type { GuestListOwnerView, GuestListView } from '../lib/types.ts';
import { Sheet } from './agenda.tsx';
import { Avatar, Button, Confirm, Field, Notice } from './ui.tsx';

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Lista VIP na página do evento de um local: quem vai põe o nome (com acompanhantes) ou tira; o dono liga e gerencia.
 * Sem pagamento. Só aparece quando a lista está ligada (ou para o dono, que pode ligá-la).
 */
export function GuestListCard({ eventId, ended }: { eventId: string; ended: boolean }) {
  const [view, setView] = useState<GuestListView | undefined>();
  const [companions, setCompanions] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [managing, setManaging] = useState(false);
  const [askLeave, setAskLeave] = useState(false);

  useEffect(() => {
    let live = true;
    api.guestList(eventId).then((v) => live && setView(v)).catch(() => live && setView(undefined));
    return () => {
      live = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (view?.mine) setCompanions(view.mine.companions);
  }, [view?.mine?.companions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || (!view.enabled && !(view.isOwner && !ended))) return null;

  async function run(job: () => Promise<GuestListView>) {
    setBusy(true);
    setProblem(undefined);
    try {
      setView(await job());
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  if (!view.enabled) {
    return (
      <section className="evguest" aria-label={t('Lista VIP')}>
        <h2 className="evinfo__title">{t('Lista VIP')}</h2>
        <p className="muted">{t('Deixe as pessoas colocarem o nome na lista deste evento. Sem pagamento.')}</p>
        <Button full variant="secondary" onClick={() => setManaging(true)}>{t('Ligar a lista')}</Button>
        {managing ? <GuestListManager eventId={eventId} view={view} onChanged={setView} onClose={() => setManaging(false)} /> : null}
      </section>
    );
  }

  const max = view.config?.maxCompanions ?? 0;
  const action = ended ? null : guestListAction(view);
  const rules = view.config ? guestListRules(view.config, view.spotsLeft, when) : '';
  return (
    <section className="evguest" aria-label={t('Lista VIP')}>
      <h2 className="evinfo__title">{t('Lista VIP')}</h2>
      {rules ? <p className="muted">{rules}</p> : null}
      {view.mine ? (
        <Notice tone="ok">
          {view.mine.checkedIn ? t('Você já entrou.') : view.mine.companions > 0 ? t('Seu nome está na lista, com {n} acompanhante(s).', { n: view.mine.companions }) : t('Seu nome está na lista.')}
        </Notice>
      ) : !view.open ? (
        <p className="muted">{ended ? t('Este evento já terminou.') : view.spotsLeft === 0 ? t('A lista está cheia.') : t('A lista já fechou.')}</p>
      ) : null}
      {action && max > 0 ? (
        <div className="evguest__companions">
          <label htmlFor="guest-companions">{t('Acompanhantes')}</label>
          <select id="guest-companions" value={companions} onChange={(e) => setCompanions(Number(e.target.value))} disabled={busy}>
            {Array.from({ length: max + 1 }, (_, n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      ) : null}
      {action ? (
        <Button full loading={busy} onClick={() => void run(() => api.joinGuestList(eventId, max > 0 ? companions : 0))}>
          {action === 'join' ? t('Colocar meu nome na lista') : t('Atualizar acompanhantes')}
        </Button>
      ) : null}
      {view.mine && !view.mine.checkedIn && !ended ? (
        askLeave ? (
          <Confirm danger question={t('Tirar seu nome da lista VIP? Se as vagas acabarem, pode não dar para voltar.')} confirmLabel={t('Tirar meu nome')} busy={busy} onConfirm={() => { setAskLeave(false); void run(() => api.leaveGuestList(eventId)); }} onCancel={() => setAskLeave(false)} />
        ) : (
          <Button full variant="quiet" loading={busy} onClick={() => setAskLeave(true)}>{t('Tirar meu nome')}</Button>
        )
      ) : null}
      {!view.mine ? <p className="muted evguest__privacy">{t('Quem administra o local vê o seu nome e o seu @usuário na lista.')}</p> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {view.isOwner ? <Button full variant="secondary" onClick={() => setManaging(true)}>{t('Gerenciar lista')}</Button> : null}
      {managing ? <GuestListManager eventId={eventId} view={view} onChanged={setView} onClose={() => setManaging(false)} /> : null}
    </section>
  );
}

/** Área do dono do local: ajustes da lista, quem está nela, marcar quem entrou e exportar em CSV. */
function GuestListManager({ eventId, view, onChanged, onClose }: { eventId: string; view: GuestListView; onChanged: (v: GuestListView) => void; onClose: () => void }) {
  const [owner, setOwner] = useState<GuestListOwnerView | undefined>();
  const [form, setForm] = useState<GuestListForm>({
    limit: view.config?.limit != null ? String(view.config.limit) : '',
    maxCompanions: String(view.config?.maxCompanions ?? 0),
    closesAt: view.config?.closesAt ? isoToLocalInput(view.config.closesAt) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [askOff, setAskOff] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  useEffect(() => {
    if (!view.enabled) return;
    let live = true;
    api.guestListEntries(eventId).then((o) => live && setOwner(o)).catch((e) => live && setProblem(toApiError(e).message));
    return () => {
      live = false;
    };
  }, [eventId, view.enabled, view.count]);

  async function guarded(job: () => Promise<void>) {
    setBusy(true);
    setProblem(undefined);
    try {
      await job();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const parsed = parseGuestListForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    await guarded(async () => {
      onChanged(await api.configureGuestList(eventId, { enabled: true, ...parsed.value }));
      setOwner(await api.guestListEntries(eventId));
    });
  }

  async function turnOff() {
    setAskOff(false);
    await guarded(async () => {
      onChanged(await api.configureGuestList(eventId, { enabled: false }));
      onClose();
    });
  }

  return (
    <Sheet title={t('Lista VIP')} onClose={onClose}>
      <div className="evguest__manage">
        <Field label={t('Limite de nomes')} type="number" inputMode="numeric" value={form.limit} onChange={(limit) => setForm({ ...form, limit })} error={errors['limit']} hint={t('Em branco: sem limite.')} />
        <Field label={t('Acompanhantes por pessoa')} type="number" inputMode="numeric" value={form.maxCompanions} onChange={(maxCompanions) => setForm({ ...form, maxCompanions })} error={errors['maxCompanions']} hint={t('De 0 a {max}.', { max: GUEST_LIST_COMPANIONS_MAX })} />
        <Field label={t('Fecha em')} type="datetime-local" value={form.closesAt} onChange={(closesAt) => setForm({ ...form, closesAt })} error={errors['closesAt']} hint={t('Em branco: até o fim do evento.')} />
        <Button full loading={busy} onClick={() => void save()}>{view.enabled ? t('Salvar ajustes') : t('Ligar a lista')}</Button>
        {problem ? <Notice tone="error">{problem}</Notice> : null}

        {view.enabled && owner ? (
          <>
            <p className="evguest__totals">
              {t('{names} nomes · {people} pessoas esperadas · {inside} já entraram', { names: owner.count, people: owner.people, inside: owner.checkedInPeople })}
            </p>
            {owner.entries.length === 0 ? <p className="muted">{t('Ninguém colocou o nome ainda.')}</p> : null}
            <ul className="evguest__list">
              {owner.entries.map((entry) => (
                <li key={entry.user.userId} className="evguest__row">
                  <Avatar profile={entry.user} size={36} />
                  <span className="evguest__who">
                    <strong>{entry.user.displayName}</strong>
                    <span className="muted">@{entry.user.username}{entry.companions > 0 ? ` · +${entry.companions}` : ''}</span>
                  </span>
                  <label className="evguest__in">
                    <input
                      type="checkbox"
                      checked={entry.checkedIn}
                      disabled={busy}
                      onChange={(e) => void guarded(async () => setOwner(await api.checkInGuest(eventId, entry.user.userId, e.target.checked)))}
                    />
                    {t('Entrou')}
                  </label>
                </li>
              ))}
            </ul>
            <Button full variant="secondary" disabled={busy} onClick={() => void guarded(async () => {
              const file = await api.exportGuestList(eventId);
              saveCsv(file.filename, file.csv);
            })}>{t('Exportar CSV')}</Button>
            <p className="muted evguest__privacy">{t('Estes nomes são de quem se inscreveu e só você vê. Use a lista só para a portaria deste evento.')}</p>
            {askOff ? (
              <Confirm danger question={t('Desligar a lista apaga todos os nomes. Continuar?')} confirmLabel={t('Desligar a lista')} busy={busy} onConfirm={() => void turnOff()} onCancel={() => setAskOff(false)} />
            ) : (
              <Button full variant="danger" disabled={busy} onClick={() => setAskOff(true)}>{t('Desligar a lista')}</Button>
            )}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
