import { useState } from 'react';
import { Wheel } from '../components/wheel.tsx';
import { Button, Confirm, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { CALENDAR_LEAD_DEFAULT, CALENDAR_LEAD_VALUES, calendarUrlProblem, draftStatusLabel, eventDraftOf, leadLabel, publishLabel, syncLabel } from '../lib/calendar-import.ts';
import { formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import type { CalendarDraft, CalendarPanel } from '../lib/types.ts';
import { VenueEventSheet } from './venues.tsx';

/** Prévia do que vai ao ar: o evento como as pessoas vão ver, com a data em que sobe. */
function DraftCard({ venueId, draft, now, onChanged, setNotice }: { venueId: string; draft: CalendarDraft; now: Date; onChanged: (panel?: CalendarPanel) => void; setNotice: (text: string | undefined) => void }) {
  const [busy, setBusy] = useState<'approve' | 'dismiss' | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const image = safeImage(draft.imageUrl);
  const approved = draft.status === 'APPROVED';

  async function approve() {
    setBusy('approve');
    setError(undefined);
    try {
      const res = await api.approveCalendarDraft(venueId, draft.id);
      if ('published' in res) setNotice(`"${draft.title}" já está no ar.`);
      else setNotice(`Aprovado. "${draft.title}" sobe ${publishLabel(res.publishAt, new Date())}.`);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    setError(undefined);
    try {
      await api.dismissCalendarDraft(venueId, draft.id);
      setNotice(`"${draft.title}" não vai subir.`);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(undefined);
      setAsking(false);
    }
  }

  return (
    <li className={`calcard${approved ? ' calcard--ok' : ''}`}>
      {image ? <img className="calcard__img" src={image} alt="" loading="lazy" /> : null}
      <div className="calcard__body">
        <p className="calcard__status">{draftStatusLabel(draft.status)}</p>
        <h3 className="calcard__title">{draft.title}</h3>
        <p className="calcard__when">{formatWhen(draft.startsAt, draft.endsAt, now)}</p>
        <p className="calcard__meta">
          {kindLabel(draft.kind)} · {draft.isFree ? 'Grátis' : 'Pago'}
          {draft.edited ? ' · Editado por você' : ''}
        </p>
        {draft.description ? <p className="calcard__desc">{draft.description}</p> : null}
        {draft.tags.length > 0 ? <p className="calcard__meta">{draft.tags.map((t) => `#${t}`).join(' ')}</p> : null}
        <p className="calcard__goes">
          <strong>{approved && new Date(draft.publishAt).getTime() <= now.getTime() ? 'Sobe em instantes' : `Sobe ${publishLabel(draft.publishAt, now)}`}</strong>
          {approved ? '' : ' se você aprovar'}
        </p>
      </div>
      {asking ? (
        <Confirm question="Este evento não vai subir. Continuar?" confirmLabel="Não publicar" danger busy={busy === 'dismiss'} onConfirm={dismiss} onCancel={() => setAsking(false)} />
      ) : (
        <div className="calcard__actions">
          {approved ? null : (
            <Button small loading={busy === 'approve'} onClick={approve}>
              Aprovar
            </Button>
          )}
          <Button small variant="secondary" onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button small variant="quiet" onClick={() => setAsking(true)}>
            {approved ? 'Cancelar' : 'Dispensar'}
          </Button>
        </div>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {editing ? (
        <VenueEventSheet
          venueId={venueId}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice('Alterações salvas.');
            onChanged();
          }}
          custom={{
            heading: 'Editar antes de publicar',
            saveLabel: 'Salvar alterações',
            initial: eventDraftOf(draft, isoToLocalInput),
            linkOnlyCover: true,
            submit: async (body) => {
              await api.editCalendarDraft(venueId, draft.id, body);
            },
          }}
        />
      ) : null}
    </li>
  );
}

export function VenueCalendarScreen({ venueId }: { venueId: string }) {
  useTitle('Agenda do local');
  const venue = useAsync(() => api.venuePanel(venueId), [venueId]);
  const panel = useAsync(() => api.calendarPanel(venueId), [venueId]);
  const [url, setUrl] = useState('');
  const [changing, setChanging] = useState(false);
  const [lead, setLead] = useState<number | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [removing, setRemoving] = useState(false);
  const now = new Date();

  const calendar = panel.data?.calendar ?? null;
  const shownLead = lead ?? calendar?.leadDays ?? CALENDAR_LEAD_DEFAULT;

  async function run(key: string, job: () => Promise<CalendarPanel | undefined>, done?: string) {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await job();
      if (done) setNotice(done);
      panel.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(undefined);
    }
  }

  function connect() {
    const problem = calendarUrlProblem(url);
    if (problem) {
      setError(problem);
      return;
    }
    void run(
      'connect',
      async () => {
        const res = await api.saveCalendar(venueId, { url: url.trim(), leadDays: shownLead });
        setUrl('');
        setChanging(false);
        setLead(undefined);
        return res;
      },
      'Agenda ligada. Os próximos eventos aparecem abaixo para você aprovar.',
    );
  }

  return (
    <>
      <PageHead title="Agenda do local" back={`/bares/${encodeURIComponent(venueId)}`} subtitle={venue.data?.venue.name ?? 'Traga os eventos do Google Agenda ou de outro calendário.'} />
      {panel.loading && !panel.data ? <Loading /> : null}
      {panel.error && !panel.data ? <ErrorState message={panel.error.message} onRetry={panel.reload} /> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {panel.data ? (
        <>
          <section className="calsec" aria-labelledby="cal-link">
            <h2 id="cal-link" className="section__title">
              Link da agenda
            </h2>
            {calendar && !changing ? (
              <>
                <p className="calsec__line">
                  <strong>{calendar.host}</strong> · {calendar.enabled ? 'ligada' : 'desligada'}
                </p>
                <p className={calendar.lastError ? 'calsec__hint calsec__hint--bad' : 'calsec__hint'}>{syncLabel(calendar, now)}</p>
                <div className="calsec__row">
                  <Button small variant="secondary" loading={busy === 'sync'} onClick={() => void run('sync', () => api.syncCalendar(venueId), 'Agenda atualizada.')}>
                    Atualizar agora
                  </Button>
                  <Button small variant="secondary" loading={busy === 'toggle'} onClick={() => void run('toggle', () => api.saveCalendar(venueId, { enabled: !calendar.enabled }))}>
                    {calendar.enabled ? 'Pausar' : 'Ligar'}
                  </Button>
                  <Button small variant="secondary" onClick={() => setChanging(true)}>
                    Trocar link
                  </Button>
                  <Button small variant="quiet" onClick={() => setRemoving(true)}>
                    Remover
                  </Button>
                </div>
                {removing ? (
                  <Confirm
                    question="Remover a agenda? Os eventos que esperam aprovação saem da fila. Os que já subiram continuam."
                    confirmLabel="Remover"
                    danger
                    busy={busy === 'remove'}
                    onConfirm={() => {
                      setRemoving(false);
                      void run('remove', async () => {
                        await api.removeCalendar(venueId);
                        return undefined;
                      }, 'Agenda removida.');
                    }}
                    onCancel={() => setRemoving(false)}
                  />
                ) : null}
              </>
            ) : (
              <>
                <p className="calsec__hint">
                  Cole o endereço <strong>iCal</strong> do calendário do seu rolê. No Google Agenda: Configurações da agenda → <em>Integrar agenda</em> → <em>Endereço secreto no formato iCal</em>.
                </p>
                <Field label="Endereço da agenda" type="url" inputMode="url" autoComplete="off" value={url} onChange={setUrl} placeholder="https://calendar.google.com/…/basic.ics" maxLength={500} hint="O endereço fica guardado só no servidor e não aparece para ninguém. Se vazar, gere outro na agenda." />
                <div className="calsec__row">
                  <Button small loading={busy === 'connect'} onClick={connect}>
                    {calendar ? 'Usar este link' : 'Ligar agenda'}
                  </Button>
                  {changing ? (
                    <Button small variant="quiet" onClick={() => { setChanging(false); setUrl(''); setError(undefined); }}>
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </section>

          <section className="calsec" aria-labelledby="cal-dias">
            <h2 id="cal-dias" className="section__title">
              Subir quantos dias antes?
            </h2>
            <p className="calsec__hint">Cada evento da agenda sobe no AskouT com essa antecedência. Nada sobe sem a sua aprovação: um dia antes você recebe um aviso com a prévia.</p>
            <div className="wheels">
              <Wheel label="Dias de antecedência" values={CALENDAR_LEAD_VALUES} value={shownLead} onChange={setLead} format={leadLabel} />
            </div>
            {calendar && lead !== undefined && lead !== calendar.leadDays ? (
              <Button small loading={busy === 'lead'} onClick={() => void run('lead', async () => { const res = await api.saveCalendar(venueId, { leadDays: lead }); setLead(undefined); return res; }, `Pronto: os eventos sobem ${leadLabel(lead)} antes.`)}>
                Salvar
              </Button>
            ) : null}
            {!calendar ? <p className="calsec__hint">Escolha os dias e depois cole o link acima.</p> : null}
          </section>

          {calendar ? (
            <section className="calsec" aria-labelledby="cal-fila">
              <h2 id="cal-fila" className="section__title">
                Para aprovar
              </h2>
              {panel.data.drafts.length === 0 ? (
                <p className="calsec__hint">{calendar.enabled ? 'Nenhum evento à vista. Quando a agenda tiver eventos nos próximos dias, eles aparecem aqui.' : 'A agenda está pausada.'}</p>
              ) : (
                <ul className="callist" aria-label="Eventos esperando aprovação">
                  {panel.data.drafts.map((d) => (
                    <DraftCard key={d.id} venueId={venueId} draft={d} now={now} onChanged={panel.reload} setNotice={setNotice} />
                  ))}
                </ul>
              )}
              <p className="calsec__hint">
                O AskouT só publica o que você aprovar e só mostra o que está na agenda.
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
