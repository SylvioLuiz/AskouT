import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CoverPicker } from '../components/cover-picker.tsx';
import { EventDates } from '../components/event-dates.tsx';
import { EventKindPicker } from '../components/event-kind-picker.tsx';
import { SampleBadge } from '../components/suggestions.tsx';
import { Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { formatWhen } from '../lib/chat.ts';
import { kindLabel } from '../lib/explore.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import type { ClaimableVenue, VenueClaim, VenueEvent, VenueSummary } from '../lib/types.ts';
import { CLAIM_NOTE_MAX, EMPTY_VENUE_EVENT, VENUE_EVENT_DESCRIPTION_MAX, VENUE_EVENT_TITLE_MAX, claimStateLabel, claimStatusLabel, documentProblem, draftFromEvent, phaseLabel, venueEventBody, venueEventProblem } from '../lib/venue.ts';
import type { VenueEventDraft } from '../lib/venue.ts';
import { Link } from '../router.tsx';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function VenueLine({ venue }: { venue: VenueSummary }) {
  return (
    <>
      <span className="venuerow__name">{venue.name}</span>
      {venue.address ? <span className="venuerow__sub">{venue.address}</span> : null}
      {venue.sample ? <SampleBadge /> : null}
    </>
  );
}

// ---------- Reivindicar um local ----------

function ClaimSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const found = useAsync(() => (debounced.length >= 2 ? api.claimableVenues(debounced) : Promise.resolve([] as ClaimableVenue[])), [debounced]);
  const [picked, setPicked] = useState<ClaimableVenue | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    const problem = documentProblem(chosen);
    setMessage(problem ?? undefined);
    setFile(problem ? undefined : chosen);
  }

  async function send() {
    if (!picked || !file) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.claimVenue(picked.id, { document: await readAsDataUrl(file), ...(note.trim() ? { note: note.trim() } : {}) });
      onSent();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Reivindicar um local" onClose={onClose}>
      {!picked ? (
        <div className="claim">
          <Field label="Nome do local" value={query} onChange={setQuery} placeholder="Ex.: Bar do Zé ou Balada Nova" autoFocus />
          {debounced.length < 2 ? <p className="muted">Digite pelo menos 2 letras. Só aparecem locais já cadastrados no AskouT.</p> : null}
          {found.loading ? <Loading /> : null}
          {found.error ? <ErrorState message={found.error.message} onRetry={found.reload} /> : null}
          {found.data && debounced.length >= 2 && found.data.length === 0 ? <p className="muted">Nenhum local com esse nome.</p> : null}
          {found.data && found.data.length > 0 ? (
            <ul className="venuelist">
              {found.data.map((v) => (
                <li key={v.id}>
                  <button type="button" className="venuerow" disabled={v.state !== 'FREE'} onClick={() => setPicked(v)}>
                    <VenueLine venue={v} />
                    {v.state !== 'FREE' ? <span className="venuerow__state">{claimStateLabel(v.state)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="claim">
          <p>
            <strong>{picked.name}</strong>
            {picked.address ? <span className="muted"> · {picked.address}</span> : null}
          </p>
          <p className="muted">Para confirmar que o local é seu, envie um documento (CNPJ, alvará ou comprovante). Só um administrador do AskouT vê o arquivo.</p>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="visually-hidden" aria-label="Escolher documento" onChange={choose} />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            {file ? 'Trocar documento' : 'Escolher documento'}
          </Button>
          {file ? <p className="claim__file">{file.name}</p> : null}
          <Field label="Mensagem (opcional)" value={note} onChange={setNote} multiline maxLength={CLAIM_NOTE_MAX} hint={`Até ${CLAIM_NOTE_MAX} caracteres`} />
          {message ? <Notice tone="error">{message}</Notice> : null}
          <div className="claim__actions">
            <Button full loading={busy} disabled={!file} onClick={send}>
              Enviar pedido
            </Button>
            <Button variant="quiet" onClick={() => setPicked(undefined)} disabled={busy}>
              Escolher outro local
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ClaimRow({ claim, onChanged }: { claim: VenueClaim; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelClaim(claim.id);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <li className={`claimrow claimrow--${claim.status.toLowerCase()}`}>
      <div className="claimrow__main">
        <span className="venuerow__name">{claim.venue.name}</span>
        <span className={`tag claimrow__status claimrow__status--${claim.status.toLowerCase()}`}>{claimStatusLabel(claim.status)}</span>
      </div>
      {claim.status === 'PENDING' ? <p className="claimrow__help">Um administrador está avaliando o documento enviado em {new Date(claim.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}. Você recebe um aviso quando houver resposta.</p> : null}
      {claim.status === 'REJECTED' && claim.reviewNote ? <p className="muted">Motivo: {claim.reviewNote}</p> : null}
      {claim.status === 'PENDING' ? (
        asking ? (
          <Confirm question="Desistir deste pedido?" confirmLabel="Desistir" danger busy={busy} onConfirm={cancel} onCancel={() => setAsking(false)} />
        ) : (
          <Button small variant="quiet" onClick={() => setAsking(true)}>
            Desistir do pedido
          </Button>
        )
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </li>
  );
}

export function VenuesScreen() {
  useTitle('Meus locais');
  const mine = useAsync(() => api.myVenues(), []);
  const [claiming, setClaiming] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <>
      <PageHead title="Meus locais" back="/perfil" subtitle="Rolês que você administra no AskouT." />
      {sent ? <Notice tone="ok">Pedido enviado. Um administrador vai analisar o documento e você recebe um aviso com a resposta.</Notice> : null}
      {mine.loading && !mine.data ? <Loading /> : null}
      {mine.error && !mine.data ? <ErrorState message={mine.error.message} onRetry={mine.reload} /> : null}
      {mine.data ? (
        <>
          {mine.data.claims.length > 0 ? (
            <section aria-labelledby="pedidos-titulo">
              <h2 id="pedidos-titulo" className="section__title">
                Seus pedidos
              </h2>
              <ul className="claimlist">
                {mine.data.claims.map((c) => (
                  <ClaimRow key={c.id} claim={c} onChanged={mine.reload} />
                ))}
              </ul>
            </section>
          ) : null}
          {mine.data.venues.length === 0 && mine.data.claims.length === 0 ? (
            <EmptyState title="Você ainda não administra nenhum local">Reivindique o seu rolê (bar, balada ou casa) para criar os eventos dele. O pedido é analisado por um administrador.</EmptyState>
          ) : mine.data.venues.length === 0 ? null : (
            <ul className="venuelist" aria-label="Locais que você administra">
              {mine.data.venues.map((v) => (
                <li key={v.id}>
                  <Link to={`/bares/${encodeURIComponent(v.id)}`} className="venuerow">
                    <VenueLine venue={v} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Button full onClick={() => setClaiming(true)}>
            Reivindicar um local
          </Button>
        </>
      ) : null}
      {claiming ? (
        <ClaimSheet
          onClose={() => setClaiming(false)}
          onSent={() => {
            setClaiming(false);
            setSent(true);
            mine.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ---------- Painel de um local ----------

export function VenueEventSheet({ venueId, event, onClose, onSaved }: { venueId: string; event?: VenueEvent; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<VenueEventDraft>(event ? draftFromEvent(event, isoToLocalInput) : EMPTY_VENUE_EVENT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const set = <K extends keyof VenueEventDraft>(key: K, value: VenueEventDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    const problem = venueEventProblem(draft, new Date(), event !== undefined);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const body = venueEventBody(draft);
      if (event) await api.updateVenueEvent(venueId, event.id, body);
      else await api.createVenueEvent(venueId, body);
      onSaved();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={event ? 'Editar evento' : 'Novo evento'} onClose={onClose}>
      <div className="claim">
        <CoverPicker imageUrl={draft.imageUrl} imageData={draft.imageData} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <Field label="Nome do evento" value={draft.title} onChange={(v) => set('title', v)} maxLength={VENUE_EVENT_TITLE_MAX} />
        <EventKindPicker value={draft.kind} onChange={(k) => set('kind', k)} />
        <EventDates starts={draft.starts} ends={draft.ends} onStarts={(v) => set('starts', v)} onEnds={(v) => set('ends', v)} />
        <label className="check">
          <input type="checkbox" checked={draft.isFree} onChange={(e) => set('isFree', e.target.checked)} />
          <span>Entrada grátis</span>
        </label>
        <Field label="Descrição (opcional)" value={draft.description} onChange={(v) => set('description', v)} multiline maxLength={VENUE_EVENT_DESCRIPTION_MAX} />
        <Field label="Hashtags (opcional)" value={draft.tags} onChange={(v) => set('tags', v)} placeholder="#samba #happyhour" hint="Até 5, separadas por espaço" />
        {message ? <Notice tone="error">{message}</Notice> : null}
        <Button full loading={busy} onClick={save}>
          {event ? 'Salvar' : 'Criar evento'}
        </Button>
      </div>
    </Sheet>
  );
}

export function VenueEventRow({ venueId, event, now, onEdit, onChanged }: { venueId: string; event: VenueEvent; now: Date; onEdit: () => void; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function remove() {
    setBusy(true);
    try {
      await api.deleteVenueEvent(venueId, event.id);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <li className={`vevent vevent--${event.phase.toLowerCase()}`}>
      <div className="vevent__main">
        <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="vevent__title">
          {event.title}
        </Link>
        <span className="vevent__when">{formatWhen(event.startsAt, event.endsAt, now)}</span>
        <span className="vevent__meta">
          {kindLabel(event.kind)} · {event.isFree ? 'Grátis' : 'Pago'} · {phaseLabel(event.phase)}
        </span>
        {event.sample ? <SampleBadge /> : null}
      </div>
      {asking ? (
        <Confirm question="Apagar este evento? Quem confirmou presença deixa de vê-lo." confirmLabel="Apagar" danger busy={busy} onConfirm={remove} onCancel={() => setAsking(false)} />
      ) : (
        <div className="vevent__actions">
          <Button small variant="secondary" onClick={onEdit}>
            Editar
          </Button>
          <Button small variant="quiet" onClick={() => setAsking(true)}>
            Apagar
          </Button>
        </div>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </li>
  );
}
