import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CoverPicker } from '../components/cover-picker.tsx';
import { EventDates } from '../components/event-dates.tsx';
import { EventKindPicker } from '../components/event-kind-picker.tsx';
import { SampleBadge } from '../components/suggestions.tsx';
import { Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { ChevronRightIcon, EditIcon, GlobeIcon, PlusIcon, SearchIcon } from '../components/icons.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { formatWhen } from '../lib/chat.ts';
import { kindLabel } from '../lib/explore.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import type { ClaimableVenue, ExplorePlace, TeamInvite, VenueClaim, VenueEvent, VenueEventBody, VenueSummary } from '../lib/types.ts';
import { CLAIM_NOTE_MAX, EMPTY_VENUE_EVENT, VENUE_EVENT_DESCRIPTION_MAX, VENUE_EVENT_TITLE_MAX, claimStateLabel, claimStatusLabel, documentProblem, draftFromEvent, phaseLabel, venueEventBody, venueEventProblem } from '../lib/venue.ts';
import type { VenueEventDraft } from '../lib/venue.ts';
import { Link } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t('Não foi possível ler o arquivo.')));
    reader.readAsDataURL(file);
  });
}

function VenueLine({ venue }: { venue: VenueSummary }) {
  return (
    <>
      <span className="venuerow__name">{venue.name}</span>
      {venue.organization ? <span className="venuerow__sub">{venue.category ?? t('Organização')}</span> : null}
      {venue.address ? <span className="venuerow__sub">{venue.address}</span> : null}
      {venue.sample ? <SampleBadge /> : null}
    </>
  );
}

// ---------- Reivindicar um local ----------

/** Com `fixed`, o pedido já é para aquele local (sem busca): usado na própria página do local. */
export function ClaimSheet({ onClose, onSent, fixed }: { onClose: () => void; onSent: () => void; fixed?: { id: string; name: string; address: string | null } }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const found = useAsync(() => (debounced.length >= 2 ? api.claimableVenues(debounced) : Promise.resolve([] as ClaimableVenue[])), [debounced]);
  const [picked, setPicked] = useState<{ id: string; name: string; address: string | null } | undefined>(fixed);
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
    <Sheet title={t('Reivindicar um local')} onClose={onClose}>
      {!picked ? (
        <div className="claim">
          <Field label={t('Nome do local')} value={query} onChange={setQuery} placeholder={t('Ex.: Bar do Zé ou Balada Nova')} autoFocus />
          {debounced.length < 2 ? <p className="muted">{t('Digite pelo menos 2 letras. Só aparecem locais já cadastrados no AskouT.')}</p> : null}
          {found.loading ? <Loading /> : null}
          {found.error ? <ErrorState message={found.error.message} onRetry={found.reload} /> : null}
          {found.data && debounced.length >= 2 && found.data.length === 0 ? <p className="muted">{t('Nenhum local com esse nome.')}</p> : null}
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
          <p className="muted">{t('Para confirmar que o local é seu, envie um documento (CNPJ, alvará ou comprovante). Só um administrador do AskouT vê o arquivo.')}</p>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="visually-hidden" aria-label={t('Escolher documento')} onChange={choose} />
          <Button variant="secondary" onClick={() => input.current?.click()}>
            {file ? t('Trocar documento') : t('Escolher documento')}
          </Button>
          {file ? <p className="claim__file">{file.name}</p> : null}
          <Field label={t('Mensagem (opcional)')} value={note} onChange={setNote} multiline maxLength={CLAIM_NOTE_MAX} hint={t('Até {CLAIM_NOTE_MAX} caracteres', { CLAIM_NOTE_MAX })} />
          {message ? <Notice tone="error">{message}</Notice> : null}
          <div className="claim__actions">
            <Button full loading={busy} disabled={!file} onClick={send}>
              {t('Enviar pedido')}
            </Button>
            {fixed ? null : (
              <Button variant="quiet" onClick={() => setPicked(undefined)} disabled={busy}>
                {t('Escolher outro local')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---------- Criar um local (botão flutuante de Meus locais) ----------

type CreateSource = 'google' | 'askout' | 'scratch';

/** Primeiro passo do botão "Criar local": de onde vem o local. */
function CreateVenueChooser({ onPick, onClose }: { onPick: (source: CreateSource) => void; onClose: () => void }) {
  const options: { source: CreateSource; icon: ReactNode; title: string; sub: string }[] = [
    { source: 'google', icon: <GlobeIcon />, title: t('A partir de um lugar do Google'), sub: t('Busque o seu rolê no Google e use o nome e o endereço de lá.') },
    { source: 'askout', icon: <SearchIcon />, title: t('Um local que já está no AskouT'), sub: t('O seu rolê já aparece no app? Peça para administrá-lo.') },
    { source: 'scratch', icon: <EditIcon />, title: t('Criar do zero'), sub: t('Não achou em lugar nenhum? Preencha nome, tipo e endereço.') },
  ];
  return (
    <Sheet title={t('Criar local')} onClose={onClose}>
      <ul className="venuelist createsource">
        {options.map((o) => (
          <li key={o.source}>
            <button type="button" className="venuerow createsource__item" onClick={() => onPick(o.source)}>
              <span className="createsource__icon" aria-hidden="true">
                {o.icon}
              </span>
              <span className="createsource__text">
                <span className="venuerow__name">{o.title}</span>
                <span className="venuerow__sub">{o.sub}</span>
              </span>
              <ChevronRightIcon />
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">{t('Em todos os casos você envia um documento e um administrador do AskouT confirma que o local é seu.')}</p>
    </Sheet>
  );
}

/**
 * Busca um lugar do Google pelo nome ou endereço (a mesma busca de vincular rolê) e cria o local no AskouT a partir
 * dele. Lugares que já estão no AskouT ficam de fora: para eles existe a opção de reivindicar.
 */
function GoogleVenueSheet({ onPicked, onClose }: { onPicked: (venue: { id: string; name: string; address: string | null }) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 350);
  const where = useCurrentPosition();
  const position = where.status === 'ok' ? where.position : undefined;
  const result = useAsync(() => (term.length >= 2 ? api.searchPlaces({ q: term, lat: position?.lat, lng: position?.lng }) : Promise.resolve(null)), [term, position?.lat, position?.lng]);
  const places = (result.data?.places ?? []).filter((p) => p.venue === null);
  const [picking, setPicking] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  async function pick(p: ExplorePlace) {
    setPicking(p.key);
    setMessage(undefined);
    try {
      const { venueId } = await api.openExternalVenue({ key: p.key, lat: p.lat, lng: p.lng });
      onPicked({ id: venueId, name: p.name, address: p.address });
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setPicking(undefined);
    }
  }

  return (
    <Sheet title={t('Criar a partir do Google')} onClose={onClose}>
      <div className="claim">
        <Field label={t('Buscar no Google')} type="search" value={q} onChange={setQ} autoFocus autoComplete="off" hint={t('Nome ou endereço do lugar')} />
        {term.length < 2 ? <p className="muted">{t('Digite o nome ou o endereço do seu rolê.')}</p> : null}
        {result.loading && !result.data ? <Loading /> : null}
        {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
        {result.data && places.length === 0 ? <p className="muted">{result.data.placesAvailable ? t('Nenhum lugar do Google com esse nome. Tente o endereço ou crie do zero.') : t('A busca do Google ainda não está ligada neste ambiente.')}</p> : null}
        {places.length > 0 ? (
          <ul className="placepick">
            {places.map((p) => (
              <li key={p.key}>
                <button type="button" className="placepick__item" disabled={picking !== undefined} aria-busy={picking === p.key || undefined} onClick={() => void pick(p)}>
                  {p.photoPath ? <img src={api.assetUrl(p.photoPath)} alt="" referrerPolicy="no-referrer" /> : null}
                  <span>
                    <strong>{p.name}</strong>
                    {p.address ? <span className="muted"> {p.address}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {message ? <Notice tone="error">{message}</Notice> : null}
        {places.some((p) => p.source === 'GOOGLE') ? <p className="muted">{t('Resultados do Google.')}</p> : null}
      </div>
    </Sheet>
  );
}

const VENUE_TYPES = ['Bar', 'Balada', 'Restaurante', 'Casa de show', 'Café', 'Outro'] as const;
export const NEW_VENUE_NAME_MAX = 80;
export const NEW_VENUE_ADDRESS_MAX = 200;

/** Cria um local do zero (não está no AskouT nem no Google). Vira um pedido: um admin confere o documento. */
export function NewVenueSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const where = useCurrentPosition();
  const [name, setName] = useState('');
  const [type, setType] = useState<string>(VENUE_TYPES[0]);
  const [address, setAddress] = useState('');
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

  const ready = name.trim() !== '' && address.trim() !== '' && file !== undefined && where.status === 'ok';

  async function send() {
    if (!file || where.status !== 'ok') return;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.requestVenue({
        name: name.trim(),
        ...(type === 'Outro' ? {} : { category: type }),
        address: address.trim(),
        lat: where.position.lat,
        lng: where.position.lng,
        document: await readAsDataUrl(file),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSent();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Criar local do zero')} onClose={onClose}>
      <div className="claim">
        <Field label={t('Nome do local')} value={name} onChange={setName} placeholder={t('Ex.: Bar do Zé ou Balada Nova')} maxLength={NEW_VENUE_NAME_MAX} autoFocus />
        <div className="field">
          <span className="field__label">{t('Tipo')}</span>
          <div className="chips" role="group" aria-label={t('Tipo')}>
            {VENUE_TYPES.map((option) => (
              <button key={option} type="button" aria-pressed={type === option} className="chip" onClick={() => setType(option)}>
                {t(option)}
              </button>
            ))}
          </div>
        </div>
        <Field label={t('Endereço')} value={address} onChange={setAddress} placeholder={t('Ex.: Rua das Flores, 120 - Centro')} maxLength={NEW_VENUE_ADDRESS_MAX} autoComplete="street-address" />
        {where.status === 'ok' ? (
          <p className="muted">{t('O local fica no mapa onde você está agora. Faça o pedido de dentro do local.')}</p>
        ) : where.status === 'asking' ? (
          <p className="muted">{t('Pegando a sua localização...')}</p>
        ) : (
          <Notice tone="error">{t('Precisamos da sua localização para colocar o local no mapa. Libere a localização do aparelho e abra de novo.')}</Notice>
        )}
        <p className="muted">{t('Para confirmar que o local é seu, envie um documento (CNPJ, alvará ou comprovante). Só um administrador do AskouT vê o arquivo.')}</p>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="visually-hidden" aria-label={t('Escolher documento')} onChange={choose} />
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {file ? t('Trocar documento') : t('Escolher documento')}
        </Button>
        {file ? <p className="claim__file">{file.name}</p> : null}
        <Field label={t('Mensagem (opcional)')} value={note} onChange={setNote} multiline maxLength={CLAIM_NOTE_MAX} hint={t('Até {CLAIM_NOTE_MAX} caracteres', { CLAIM_NOTE_MAX })} />
        {message ? <Notice tone="error">{message}</Notice> : null}
        <div className="claim__actions">
          <Button full loading={busy} disabled={!ready} onClick={send}>
            {t('Enviar pedido')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- Criar uma página de organização ----------

/** Tipos de organização, em dois blocos: os da facul vêm primeiro (público principal), depois o resto. */
const ORG_TYPE_GROUPS = [
  {
    title: 'Da facul',
    types: [
      { label: 'Atlética', emoji: '🏆' },
      { label: 'Bateria', emoji: '🥁' },
      { label: 'Centro acadêmico', emoji: '📣' },
      { label: 'Empresa júnior', emoji: '💼' },
      { label: 'Liga acadêmica', emoji: '🧪' },
    ],
  },
  {
    title: 'De qualquer lugar',
    types: [
      { label: 'Coletivo', emoji: '✊' },
      { label: 'Produtora de festa', emoji: '🪩' },
      { label: 'Grupo ou galera', emoji: '🫶' },
      { label: 'Empresa ou marca', emoji: '🏢' },
      { label: 'Time ou esporte', emoji: '⚽' },
      { label: 'Projeto social', emoji: '🌱' },
      { label: 'Outro', emoji: '✨' },
    ],
  },
] as const;
const CAMPUS_TYPES: readonly string[] = ORG_TYPE_GROUPS[0].types.map((x) => x.label);
export const ORGANIZATION_NAME_MAX = 80;
export const ORGANIZATION_CAMPUS_MAX = 120;
export const ORGANIZATION_DESCRIPTION_MAX = 500;

/**
 * Pede a página de uma organização: da facul (atlética, bateria, centro acadêmico...) ou de fora dela (coletivo,
 * produtora, empresa, galera...). Quem segue a página e toca no sininho recebe aviso de cada evento novo.
 * Um administrador confere o comprovante antes de a página aparecer.
 */
export function OrganizationSheet({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const where = useCurrentPosition();
  const [name, setName] = useState('');
  const [type, setType] = useState<string>(ORG_TYPE_GROUPS[0].types[0].label);
  const [campus, setCampus] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const fromCampus = CAMPUS_TYPES.includes(type);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    const problem = documentProblem(chosen);
    setMessage(problem ?? undefined);
    setFile(problem ? undefined : chosen);
  }

  const ready = name.trim() !== '' && campus.trim() !== '' && file !== undefined && where.status === 'ok';

  async function send() {
    if (!file || where.status !== 'ok') return;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.requestOrganization({
        name: name.trim(),
        type: type === 'Outro' ? undefined : type,
        campus: campus.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        lat: where.position.lat,
        lng: where.position.lng,
        document: await readAsDataUrl(file),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSent();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Criar página de organização')} onClose={onClose}>
      <div className="claim">
        <div className="orghero">
          <span className="orghero__emojis" aria-hidden="true">
            🥁🏆🪩✊
          </span>
          <p className="orghero__title">{t('Sua galera merece uma página')}</p>
          <p className="orghero__text">{t('Atlética, bateria, coletivo, produtora, empresa ou aquele grupo que vive marcando rolê. Quem seguir e ligar o sininho fica sabendo de cada evento novo.')}</p>
        </div>
        <Field label={t('Nome da organização')} value={name} onChange={setName} placeholder={fromCampus ? t('Ex.: Bateria Furiosa') : t('Ex.: Coletivo Noite Preta')} maxLength={ORGANIZATION_NAME_MAX} autoFocus />
        <div className="field">
          <span className="field__label">{t('O que vocês são?')}</span>
          {ORG_TYPE_GROUPS.map((group) => (
            <div key={group.title} className="orgtypes">
              <span className="orgtypes__title">{t(group.title)}</span>
              <div className="chips" role="group" aria-label={t(group.title)}>
                {group.types.map((option) => (
                  <button key={option.label} type="button" aria-pressed={type === option.label} className="chip orgchip" onClick={() => setType(option.label)}>
                    <span aria-hidden="true">{option.emoji}</span> {t(option.label)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Field
          label={fromCampus ? t('Faculdade e campus') : t('Onde vocês ficam')}
          value={campus}
          onChange={setCampus}
          placeholder={fromCampus ? t('Ex.: UFMG, Campus Pampulha') : t('Ex.: Savassi, Belo Horizonte')}
          hint={fromCampus ? undefined : t('Bairro, cidade, faculdade ou o point de vocês.')}
          maxLength={ORGANIZATION_CAMPUS_MAX}
        />
        <Field label={t('Descrição (opcional)')} value={description} onChange={setDescription} multiline maxLength={ORGANIZATION_DESCRIPTION_MAX} />
        {where.status === 'ok' ? (
          <p className="muted">{fromCampus ? t('A página fica no mapa onde você está agora. Faça o pedido de dentro do campus.') : t('A página fica no mapa onde você está agora. Faça o pedido da sede ou do point de vocês.')}</p>
        ) : where.status === 'asking' ? (
          <p className="muted">{t('Pegando a sua localização...')}</p>
        ) : (
          <Notice tone="error">{t('Precisamos da sua localização para colocar a organização no mapa. Libere a localização do aparelho e abra de novo.')}</Notice>
        )}
        <p className="muted">{fromCampus ? t('Envie um comprovante de que você representa a organização (ata, carteirinha, declaração da faculdade ou print do perfil oficial). Só um administrador do AskouT vê o arquivo.') : t('Envie um comprovante de que você representa a organização (print do perfil oficial, CNPJ, crachá ou qualquer coisa que mostre o vínculo). Só um administrador do AskouT vê o arquivo.')}</p>
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="visually-hidden" aria-label={t('Escolher comprovante')} onChange={choose} />
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {file ? t('Trocar comprovante') : t('Escolher comprovante')}
        </Button>
        {file ? <p className="claim__file">{file.name}</p> : null}
        <Field label={t('Mensagem (opcional)')} value={note} onChange={setNote} multiline maxLength={CLAIM_NOTE_MAX} hint={t('Até {CLAIM_NOTE_MAX} caracteres', { CLAIM_NOTE_MAX })} />
        {message ? <Notice tone="error">{message}</Notice> : null}
        <div className="claim__actions">
          <Button full loading={busy} disabled={!ready} onClick={send}>
            {t('Enviar pedido')}
          </Button>
        </div>
      </div>
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
      {claim.status === 'PENDING' ? <p className="claimrow__help">{t('Um administrador está avaliando o documento enviado em {date}. Você recebe um aviso quando houver resposta.', { date: new Date(claim.createdAt).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long' }) })}</p> : null}
      {claim.status === 'REJECTED' && claim.reviewNote ? <p className="muted">Motivo: {claim.reviewNote}</p> : null}
      {claim.status === 'PENDING' ? (
        asking ? (
          <Confirm question={t('Desistir deste pedido?')} confirmLabel={t('Desistir')} danger busy={busy} onConfirm={cancel} onCancel={() => setAsking(false)} />
        ) : (
          <Button small variant="quiet" onClick={() => setAsking(true)}>
            {t('Desistir do pedido')}
          </Button>
        )
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </li>
  );
}

function InviteRow({ invite, onChanged }: { invite: TeamInvite; onChanged: () => void }) {
  const [busy, setBusy] = useState<'yes' | 'no' | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function answer(accept: boolean) {
    setBusy(accept ? 'yes' : 'no');
    setError(undefined);
    try {
      await api.respondVenueInvite(invite.venue.id, accept);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(undefined);
    }
  }

  return (
    <li className="claimrow">
      <div className="venuerow venuerow--static">
        <VenueLine venue={invite.venue} />
        <span className="venuerow__sub">{invite.invitedBy ? t('Convite de @{username}', { username: invite.invitedBy.username }) : t('Convite para a equipe')}</span>
      </div>
      <div className="claimrow__actions">
        <Button small loading={busy === 'yes'} disabled={busy !== undefined} onClick={() => void answer(true)}>
          {t('Aceitar')}
        </Button>
        <Button small variant="quiet" loading={busy === 'no'} disabled={busy !== undefined} onClick={() => void answer(false)}>
          {t('Recusar')}
        </Button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </li>
  );
}

export function VenuesScreen() {
  useTitle(t('Meus locais'));
  const mine = useAsync(() => api.myVenues().then((m) => ({ ...m, managed: m.managed ?? [], invites: m.invites ?? [] })), []);
  const [claiming, setClaiming] = useState(false);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [sent, setSent] = useState(false);
  /** Botão flutuante "Criar local": escolher a origem, buscar no Google, criar do zero ou pedir o local do Google. */
  const [creating, setCreating] = useState<'choose' | 'google' | 'scratch' | undefined>();
  const [fromGoogle, setFromGoogle] = useState<{ id: string; name: string; address: string | null } | undefined>();
  const done = () => {
    setClaiming(false);
    setCreating(undefined);
    setFromGoogle(undefined);
    setSent(true);
    mine.reload();
  };

  return (
    <>
      <PageHead title={t('Meus locais')} back="/perfil" subtitle={t('Rolês que você administra no AskouT.')} />
      {sent ? <Notice tone="ok">{t('Pedido enviado. Um administrador vai analisar o documento e você recebe um aviso com a resposta.')}</Notice> : null}
      {mine.loading && !mine.data ? <Loading /> : null}
      {mine.error && !mine.data ? <ErrorState message={mine.error.message} onRetry={mine.reload} /> : null}
      {mine.data ? (
        <>
          {mine.data.invites.length > 0 ? (
            <section aria-labelledby="convites-titulo">
              <h2 id="convites-titulo" className="section__title">
                {t('Convites para a equipe')}
              </h2>
              <ul className="claimlist">
                {mine.data.invites.map((i) => (
                  <InviteRow key={i.venue.id} invite={i} onChanged={mine.reload} />
                ))}
              </ul>
            </section>
          ) : null}
          {mine.data.claims.length > 0 ? (
            <section aria-labelledby="pedidos-titulo">
              <h2 id="pedidos-titulo" className="section__title">
                {t('Seus pedidos')}
              </h2>
              <ul className="claimlist">
                {mine.data.claims.map((c) => (
                  <ClaimRow key={c.id} claim={c} onChanged={mine.reload} />
                ))}
              </ul>
            </section>
          ) : null}
          {mine.data.venues.length === 0 && mine.data.managed.length === 0 && mine.data.invites.length === 0 && mine.data.claims.length === 0 ? (
            <EmptyState title={t('Você ainda não administra nenhum local')}>{t('Toque em Criar local para trazer o seu rolê (bar, balada ou casa) do Google, do AskouT ou do zero. O pedido é analisado por um administrador.')}</EmptyState>
          ) : mine.data.venues.length + mine.data.managed.length === 0 ? null : (
            <ul className="venuelist" aria-label={t('Locais que você administra')}>
              {[...mine.data.venues, ...mine.data.managed].map((v) => (
                <li key={v.id}>
                  <Link to={`/bares/${encodeURIComponent(v.id)}/painel`} className="venuerow">
                    <VenueLine venue={v} />
                    {mine.data?.managed.some((m) => m.id === v.id) ? <span className="venuerow__sub">{t('Você é administrador')}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="venueactions venueactions--fab">
            <Button full variant="secondary" onClick={() => setCreatingOrg(true)}>
              {t('Criar página de organização (atlética, coletivo, produtora...)')}
            </Button>
          </div>
        </>
      ) : null}
      {mine.data ? (
        <button type="button" className="fab" onClick={() => setCreating('choose')}>
          <PlusIcon />
          {t('Criar local')}
        </button>
      ) : null}
      {creating === 'choose' ? (
        <CreateVenueChooser
          onClose={() => setCreating(undefined)}
          onPick={(source) => {
            if (source === 'askout') {
              setCreating(undefined);
              setClaiming(true);
            } else setCreating(source);
          }}
        />
      ) : null}
      {creating === 'google' ? (
        <GoogleVenueSheet
          onClose={() => setCreating(undefined)}
          onPicked={(venue) => {
            setCreating(undefined);
            setFromGoogle(venue);
          }}
        />
      ) : null}
      {fromGoogle ? <ClaimSheet fixed={fromGoogle} onClose={() => setFromGoogle(undefined)} onSent={done} /> : null}
      {creating === 'scratch' ? <NewVenueSheet onClose={() => setCreating(undefined)} onSent={done} /> : null}
      {creatingOrg ? (
        <OrganizationSheet
          onClose={() => setCreatingOrg(false)}
          onSent={() => {
            setCreatingOrg(false);
            setSent(true);
            mine.reload();
          }}
        />
      ) : null}
      {claiming ? (
        <ClaimSheet onClose={() => setClaiming(false)} onSent={done} />
      ) : null}
    </>
  );
}

// ---------- Painel de um local ----------

/**
 * Formulário de evento. Sem `custom`, cria ou edita um evento do local. Com `custom`, serve a outro destino
 * (por exemplo, o rascunho vindo da agenda): usa os dados iniciais dele e entrega o corpo a `custom.submit`.
 */
export function VenueEventSheet({ venueId, event, onClose, onSaved, custom }: { venueId: string; event?: VenueEvent; onClose: () => void; onSaved: () => void; custom?: { heading: string; saveLabel: string; initial: VenueEventDraft; linkOnlyCover?: boolean; submit: (body: VenueEventBody) => Promise<void> } }) {
  const [draft, setDraft] = useState<VenueEventDraft>(custom ? custom.initial : event ? draftFromEvent(event, isoToLocalInput) : EMPTY_VENUE_EVENT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const set = <K extends keyof VenueEventDraft>(key: K, value: VenueEventDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    const problem = venueEventProblem(draft, new Date(), event !== undefined || custom !== undefined);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const body = venueEventBody(draft);
      if (custom) await custom.submit(body);
      else if (event) await api.updateVenueEvent(venueId, event.id, body);
      else await api.createVenueEvent(venueId, body);
      onSaved();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={custom ? custom.heading : event ? t('Editar evento') : t('Novo evento')} onClose={onClose}>
      <div className="claim">
        <CoverPicker venueId={venueId} linkOnly={custom?.linkOnlyCover === true} imageUrl={draft.imageUrl} imageData={draft.imageData} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <Field label={t('Nome do evento')} value={draft.title} onChange={(v) => set('title', v)} maxLength={VENUE_EVENT_TITLE_MAX} />
        <EventKindPicker value={draft.kind} onChange={(k) => set('kind', k)} />
        <EventDates starts={draft.starts} ends={draft.ends} onStarts={(v) => set('starts', v)} onEnds={(v) => set('ends', v)} />
        <label className="check">
          <input type="checkbox" checked={draft.isFree} onChange={(e) => set('isFree', e.target.checked)} />
          <span>{t('Entrada grátis')}</span>
        </label>
        <Field label={t('Descrição (opcional)')} value={draft.description} onChange={(v) => set('description', v)} multiline maxLength={VENUE_EVENT_DESCRIPTION_MAX} />
        <Field label={t('Hashtags (opcional)')} value={draft.tags} onChange={(v) => set('tags', v)} placeholder="#samba #happyhour" hint={t('Até 5, separadas por espaço')} />
        <Field
          label={t('Link para comprar ingresso (opcional)')}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={draft.ticketUrl}
          onChange={(v) => set('ticketUrl', v)}
          placeholder="https://"
          hint={t('Site do local ou de uma bilheteria. O AskouT só leva a pessoa até lá: não vende nem cobra o ingresso.')}
        />
        {message ? <Notice tone="error">{message}</Notice> : null}
        <Button full loading={busy} onClick={save}>
          {custom ? custom.saveLabel : event ? t('Salvar') : t('Criar evento')}
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
          {kindLabel(event.kind)} · {event.isFree ? t('Grátis') : t('Pago')} · {phaseLabel(event.phase)}
        </span>
        {event.sample ? <SampleBadge /> : null}
      </div>
      {asking ? (
        <Confirm question={t('Apagar este evento? Quem confirmou presença deixa de vê-lo.')} confirmLabel={t('Apagar')} danger busy={busy} onConfirm={remove} onCancel={() => setAsking(false)} />
      ) : (
        <div className="vevent__actions">
          <Button small variant="secondary" onClick={onEdit}>
            {t('Editar')}
          </Button>
          {event.phase === 'PAST' ? null : (
            <Link to={`/bares/${encodeURIComponent(venueId)}/eventos/${encodeURIComponent(event.id)}/chapelaria`} className="btn btn--secondary btn--small">
              {t('Chapelaria')}
            </Link>
          )}
          <Button small variant="quiet" onClick={() => setAsking(true)}>
            {t('Apagar')}
          </Button>
        </div>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </li>
  );
}
