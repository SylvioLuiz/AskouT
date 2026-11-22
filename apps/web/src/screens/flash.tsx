import { OpenInMaps } from '../components/open-in-maps.tsx';
import { lazyWithReload } from '../lib/chunk-reload.ts';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { BoltIcon, ChatIcon, CheckIcon, ChevronRightIcon, ClockIcon, HelpIcon, LocationIcon, LockIcon, MapIcon, PlusIcon, RefreshIcon, UserPlusIcon, UsersIcon, XIcon } from '../components/icons.tsx';
import { InviteFocusCard, NowFace, useTick } from '../components/now-invite.tsx';
import type { NowPin } from '../components/now-map.tsx';
import { useUser } from '../auth.tsx';
import { Sheet } from '../components/agenda.tsx';
import { RingLoader } from '../components/ring-loader.tsx';
import { MatchPlaceSearch } from '../components/match-place-search.tsx';
import { nowRadiusKm } from '../lib/now-radius.ts';
import { ChatButton } from '../components/chat-button.tsx';
import { InviteSheet } from '../components/invite.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { OfferBanner } from '../components/offer-banner.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import {
  announceFlashChange,
  distanceMeters,
  FLASH_CHANGED_EVENT,
  formatClock,
  FLASH_DEFAULT_MINUTES,
  formatFlashDuration,
  FLASH_NOTE_MAX,
  flashNoteProblem,
  flashRemainingShare,
  formatAge,
  formatApprox,
  formatDistance,
  formatKm,
  formatRemaining,
  geolocationMessage,
  minutesLeft,
} from '../lib/flash.ts';
import { initials } from '../lib/avatar.ts';
import { toApiError } from '../lib/errors.ts';
import { FLASH_PRIVACY_POINTS, flashNoticeSeen, markFlashNoticeSeen, safeStorage } from '../lib/hints.ts';
import type { PlacePin, RouteLine } from '../components/match-map.tsx';
import { MatchDestination, MatchPlaces } from '../components/match-destination.tsx';
import { MAX_PLACES_ON_MAP, placeName, sortByFairness } from '../lib/flash.ts';
import type { AvailableFriend, AvailableOrder, FlashMatch, PublicProfile, SuggestionItem } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

const POLL_MS = 10_000;
/** Durações oferecidas ao ligar o Flash (a API aceita de 5 min a 3 h). */
const DURATIONS: readonly { minutes: number; value: string; unit: string; label: string }[] = [
  { minutes: 30, value: '30', unit: 'min', label: t('30 minutos') },
  { minutes: 60, value: '1', unit: 'hora', label: t('1 hora') },
  { minutes: 120, value: '2', unit: 'horas', label: t('2 horas') },
  { minutes: 180, value: '3', unit: 'horas', label: t('3 horas') },
];

// O mapa (MapLibre) é pesado: só é baixado quando alguém abre um encontro.
const MatchMap = lazyWithReload(() => import('../components/match-map.tsx'));
const NowMap = lazyWithReload(() => import('../components/now-map.tsx'));

const ORDER_KEY = 'askout.now.order';

/** Posição do aparelho para ordenar "mais perto". Se a pessoa negar ou demorar, o NOW liga sem ela. */
function approxPosition(): Promise<{ lat: number; lng: number } | undefined> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(undefined), 6000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        window.clearTimeout(timer);
        resolve(undefined);
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 10 * 60_000 },
    );
  });
}

function savedOrder(): AvailableOrder | undefined {
  try {
    const v = safeStorage()?.getItem(ORDER_KEY);
    return v === 'near' || v === 'interaction' ? v : undefined;
  } catch {
    return undefined;
  }
}

type Feedback = { tone: 'ok' | 'error'; text: string } | undefined;

// ---------- Trava de idade ----------

// ---------- Tela do Flash ----------

export function FlashScreen() {
  useTitle(t('NOW'));
  return <FlashContent />;
}

function FlashContent() {
  const user = useUser();
  const status = useAsync(() => api.flashStatus(), []);
  const active = status.data?.active === true;
  const [order, setOrder] = useState<AvailableOrder | undefined>(savedOrder);
  const [listMeta, setListMeta] = useState<{ order: AvailableOrder; nearAvailable: boolean } | undefined>();
  const available = useAsync(
    () =>
      active
        ? api.flashAvailable(order).then((r) => {
            setListMeta({ order: r.order, nearAvailable: r.nearAvailable });
            return r.items;
          })
        : Promise.resolve([] as AvailableFriend[]),
    [active, order],
  );
  function chooseOrder(next: AvailableOrder) {
    setOrder(next);
    try {
      safeStorage()?.setItem(ORDER_KEY, next);
    } catch {
      // sem armazenamento: a escolha vale só nesta visita
    }
  }
  const invites = useAsync(() => api.flashInvites(), []);

  // Encontros aceitos: a posição exata de quem aceitou sair com você (só dessas pessoas).
  const matchIds = (invites.data?.matches ?? []).map((m) => m.id);
  const matchKey = matchIds.join(',');
  const matchViews = useAsync(
    () => (active && matchIds.length > 0 ? Promise.all(matchIds.map((id) => api.flashMatch(id).catch(() => undefined))).then((r) => r.filter((m): m is FlashMatch => m !== undefined)) : Promise.resolve([] as FlashMatch[])),
    [active, matchKey],
  );
  const share = useShareLocation(
    matchIds,
    () => {
      invites.reload();
      matchViews.reload();
    },
    // Ligou o NOW, a localização já liga. A posição exata só vai para quem você aprovou (convite aceito).
    active,
  );

  const [minutes, setMinutes] = useState(FLASH_DEFAULT_MINUTES);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [started, setStarted] = useState<string | undefined>();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapFriend, setMapFriend] = useState<string | undefined>();
  const [callAllOpen, setCallAllOpen] = useState(false);
  const [callingAll, setCallingAll] = useState(false);
  const [approxAll, setApproxAll] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  // Convites em foco: o resto da tela fica esmaecido até responder ou tocar fora.
  const [unfocused, setUnfocused] = useState<string>('');
  // Quando o foco começa (convite novo, ou o mapa fechou com convite esperando), a tela rola até o convite:
  // com a página rolada para baixo, só se veria a tela esmaecida.
  const inviteStackRef = useRef<HTMLDivElement>(null);
  const pendingInvites = (invites.data?.received ?? []).map((i) => i.id).join(',');
  useEffect(() => {
    if (!pendingInvites || pendingInvites === unfocused || mapOpen) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    inviteStackRef.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [pendingInvites, unfocused, mapOpen]);

  // O aviso de "NOW ativado" some sozinho depois de 3 segundos.
  useEffect(() => {
    if (!started) return undefined;
    const timer = window.setTimeout(() => setStarted(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [started]);

  // O tempo restante e as listas se atualizam sozinhos.
  usePolling(() => {
    status.reload();
    invites.reload();
    available.reload();
    matchViews.reload();
  }, POLL_MS);

  // Convite respondido pelo aviso do topo (ou em outra aba): a tela acompanha.
  useEffect(() => {
    const onChange = () => {
      status.reload();
      invites.reload();
      available.reload();
    };
    window.addEventListener(FLASH_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(FLASH_CHANGED_EVENT, onChange);
  });

  // Toque em "Atualizar": o ícone gira enquanto as listas voltam (no mínimo um instante, para dar para ver que atualizou).
  const [refreshing, setRefreshing] = useState(false);
  const loadingAny = status.loading || invites.loading || available.loading || matchViews.loading;
  useEffect(() => {
    if (!refreshing || loadingAny) return;
    const timer = setTimeout(() => setRefreshing(false), 600);
    return () => clearTimeout(timer);
  }, [refreshing, loadingAny]);
  function reloadAll() {
    status.reload();
    invites.reload();
    available.reload();
    matchViews.reload();
  }
  function refreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    reloadAll();
  }

  const [explaining, setExplaining] = useState(false);

  // Primeira vez: explica quem vê e o que é compartilhado antes de ligar.
  function turnOn() {
    const problem = flashNoteProblem(note);
    setNoteError(problem);
    if (problem) return;
    if (!flashNoticeSeen(safeStorage())) {
      setExplaining(true);
      return;
    }
    void doTurnOn();
  }

  async function doTurnOn() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const next = await api.flashOn(minutes, note.trim(), await approxPosition());
      status.setData(next);
      const until = next.expiresAt ? new Date(next.expiresAt) : new Date(Date.now() + minutes * 60_000);
      setStarted(t('{duration}, até {time}', { duration: formatFlashDuration(minutes), time: until.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) }));
      available.reload();
      announceFlashChange();
    } catch (failure) {
      const error = toApiError(failure);
      setNoteError(error.fields['note']);
      setFeedback({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  const [extending, setExtending] = useState<30 | 60 | undefined>();
  async function extend(by: 30 | 60) {
    setExtending(by);
    setFeedback(undefined);
    try {
      const next = await api.flashExtend(by);
      status.setData(next);
      setPlusOpen(false);
      const until = next.expiresAt ? new Date(next.expiresAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
      setFeedback({ tone: 'ok', text: t('NOW estendido até {time}.', { time: until }) });
      announceFlashChange();
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setExtending(undefined);
    }
  }

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  async function saveNote(value: string) {
    const problem = flashNoteProblem(value);
    setNoteError(problem);
    if (problem) return;
    setSavingNote(true);
    try {
      const next = await api.flashSetNote(value.trim());
      status.setData(next);
      setEditingNote(false);
      announceFlashChange();
    } catch (failure) {
      const error = toApiError(failure);
      setNoteError(error.fields['note'] ?? error.message);
    } finally {
      setSavingNote(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setFeedback(undefined);
    try {
      await api.flashOff();
      setConfirmOff(false);
      setNote('');
      reloadAll();
      announceFlashChange();
      setFeedback({ tone: 'ok', text: t('NOW desligado. Seus convites foram cancelados.') });
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  if (status.loading && !status.data) return <Loading />;
  if (status.error && !status.data) return <ErrorState message={status.error.message} onRetry={status.reload} />;

  const howSheet = infoOpen ? <HowItWorks onClose={() => setInfoOpen(false)} /> : null;
  const askSheet = asking ? <AskSheet onClose={() => setAsking(false)} onFeedback={setFeedback} /> : null;
  const feedbackLine = feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null;

  if (!active) {
    return (
      <section className="nowoff" aria-label={t('Ligar o NOW')}>
        {feedbackLine}
        <OfferBanner />
        <header className="nowhead">
          <div>
            <h1 className="nowhead__title">
              NOW <BoltIcon filled />
            </h1>
            <p className="nowhead__sub">{t('Livre agora? Encontre alguém para sair.')}</p>
          </div>
          <button type="button" className="nowhead__how" onClick={() => setInfoOpen(true)}>
            <HelpIcon />
            {t('Como funciona?')}
          </button>
        </header>

        <NowRadar me={user.profile} />

        <label className="nownote nownote--input">
          <span className="visually-hidden">{t('Recado (opcional)')}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('No que você tá a fim?')}
            maxLength={FLASH_NOTE_MAX + 20}
            autoComplete="off"
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? 'now-note-error' : undefined}
          />
        </label>
        {noteError ? (
          <p className="nowoff__error" id="now-note-error" role="alert">
            {noteError}
          </p>
        ) : note !== '' ? (
          <p className="nowoff__count">
            {Array.from(note).length}/{FLASH_NOTE_MAX}
          </p>
        ) : null}

        <div className="nowdur" role="radiogroup" aria-label={t('Duração do NOW')}>
          {DURATIONS.map((d) => (
            <button key={d.minutes} type="button" role="radio" aria-checked={minutes === d.minutes} aria-label={d.label} className="nowdur__opt" onClick={() => setMinutes(d.minutes)}>
              {d.value} {d.unit}
            </button>
          ))}
        </div>

        <button type="button" className="nowgo" disabled={busy} aria-busy={busy || undefined} onClick={turnOn}>
          <BoltIcon filled />
          {t('Ativar NOW')}
        </button>
        <p className="nowoff__privacy">
          <LockIcon />
          {t('Só amigos veem. Localização exata só com quem você aprovar.')}
        </p>

        <button type="button" className="nowask" onClick={() => setAsking(true)}>
          <span className="nowask__icon" aria-hidden="true">
            <UsersIcon />
          </span>
          <span className="nowask__body">
            <strong>{t('Perguntar se está livre')}</strong>
            <span>{t('Mande um aviso para amigos. Quando ligarem o NOW, você fica sabendo.')}</span>
          </span>
          <ChevronRightIcon />
        </button>

        {explaining ? (
          <Sheet title={t('Antes de ligar o NOW')} onClose={() => setExplaining(false)}>
            <ul className="flashnotice">
              {FLASH_PRIVACY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <Button
              full
              onClick={() => {
                markFlashNoticeSeen(safeStorage());
                setExplaining(false);
                void doTurnOn();
              }}
            >
              {t('Entendi, ligar o NOW')}
            </Button>
          </Sheet>
        ) : null}
        {howSheet}
        {askSheet}
      </section>
    );
  }

  const received = invites.data?.received ?? [];
  const matches = invites.data?.matches ?? [];
  const friends = available.data ?? [];
  const empty = available.data !== undefined && friends.length === 0;
  const eligible = friends.filter((f) => f.invite === null);
  const friendById = new Map(friends.map((f) => [f.profile.userId, f] as const));
  const focusKey = received.map((i) => i.id).join(',');
  // Com o mapa aberto, o convite aparece dentro da janela do mapa (o foco da tela ficaria por baixo dela).
  const focusing = received.length > 0 && unfocused !== focusKey && !mapOpen;

  // Distância exata só de quem aceitou o convite e já enviou a posição.
  const exactById = new Map<string, { lat: number; lng: number; km: string }>();
  for (const m of matchViews.data ?? []) {
    const origin = m.me ?? share.mine;
    if (m.them) exactById.set(m.other.userId, { lat: m.them.lat, lng: m.them.lng, km: origin ? formatKm(distanceMeters(origin, m.them)) : '' });
  }
  const distanceOf = (f: AvailableFriend) => exactById.get(f.profile.userId)?.km || (f.approx ? formatApprox(f.approx, true) : '');

  async function callAll() {
    setCallingAll(true);
    setFeedback(undefined);
    const results = await Promise.allSettled(eligible.map((f) => api.flashInvite(f.profile.userId, approxAll)));
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - sent;
    setCallingAll(false);
    setCallAllOpen(false);
    setFeedback(
      failed === 0
        ? { tone: 'ok', text: sent === 1 ? t('Convite enviado. Vale por 15 minutos.') : t('{sent} convites enviados. Valem por 15 minutos.', { sent }) }
        : { tone: 'error', text: t('{sent} de {length} convites enviados. Os outros não puderam ser enviados agora.', { sent, length: results.length }) },
    );
    reloadAll();
  }

  const expiresAt = status.data?.expiresAt ?? null;
  const until = expiresAt ? new Date(expiresAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
  const left = expiresAt ? minutesLeft(expiresAt, Date.now()) : 0;

  return (
    <div className={`nowon${focusing ? ' nowon--focus' : ''}`}>
      {started ? (
        <div className="flashtoast" role="status">
          <span className="flashtoast__bolt">
            <BoltIcon filled />
          </span>
          <strong>{t('NOW ativado')}</strong>
          <span>{started}</span>
        </div>
      ) : null}
      <header className="nowhead">
        <div>
          <h1 className="nowhead__title">
            NOW <BoltIcon filled />
          </h1>
          <p className="nowhead__sub">{t('Você está disponível agora.')}</p>
        </div>
        <button type="button" className="nowhead__how" onClick={() => setInfoOpen(true)}>
          <HelpIcon />
          {t('Como funciona?')}
        </button>
      </header>
      {feedbackLine}

      {/* Convites primeiro: é o que pede resposta. */}
      {received.length > 0 ? (
        <>
          {focusing ? <button type="button" className="nowon__veil" aria-label={t('Voltar para a tela')} onClick={() => setUnfocused(focusKey)} /> : null}
          <div className="nowinv-stack" ref={inviteStackRef}>
            {received.map((invite) => (
              <InviteFocusCard key={invite.id} invite={invite} friend={friendById.get(invite.other.userId)} onDone={reloadAll} />
            ))}
          </div>
        </>
      ) : null}

      {matches.length > 0 ? (
        <ul className="nowmatches" aria-label={t('Encontros em andamento')}>
          {matches.map((invite) => (
            <li key={invite.id}>
              <Link to={`/now/encontro/${invite.id}`} className="nowmatch">
                <NowFace profile={invite.other} size={36} />
                <span>
                  <strong>{t('{name} aceitou sair com você', { name: invite.other.username })}</strong>
                  <span>{t('Ver encontro e mapa')}</span>
                </span>
                <ChevronRightIcon />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="nowcard" aria-label={t('Seu NOW')}>
        <button type="button" className="nowcard__plus" aria-haspopup="menu" aria-expanded={plusOpen} aria-label={t('Estender o NOW')} disabled={left >= 179} onClick={() => setPlusOpen((o) => !o)}>
          <PlusIcon />
        </button>
        {plusOpen ? (
          <div className="nowcard__menu" role="menu">
            {([30, 60] as const).map((by) => (
              <button key={by} type="button" role="menuitem" disabled={extending !== undefined} aria-busy={extending === by || undefined} onClick={() => void extend(by)}>
                {by === 30 ? t('+30 min') : t('+1 hora')}
              </button>
            ))}
          </div>
        ) : null}
        <span className="nowcard__me">
          <button
            type="button"
            className={`nownote nownote--small nownote--edit${status.data?.note ? '' : ' nownote--add'}`}
            aria-label={status.data?.note ? t('Editar recado: {note}', { note: status.data.note }) : t('Adicionar recado')}
            onClick={() => {
              setNoteDraft(status.data?.note ?? '');
              setNoteError(undefined);
              setEditingNote(true);
            }}
          >
            {status.data?.note ?? t('+ Recado')}
          </button>
          <span className="nowcard__ring">
            <NowFace profile={user.profile} size={56} />
          </span>
        </span>
        <div className="nowcard__info">
          <span className="nowcard__time">{expiresAt ? <NowClock expiresAt={expiresAt} /> : null}</span>
          <span className="nowcard__until">{t('NOW ativo · até {time}', { time: until })}</span>
          {share.state.phase === 'sharing' ? (
            <button type="button" className="nowloc nowloc--on" onClick={share.stop} title={t('Desligar a localização')}>
              <i aria-hidden="true" />
              {t('Localização ligada')}
            </button>
          ) : share.state.phase === 'asking' ? (
            <span className="nowloc">{t('Ligando a localização…')}</span>
          ) : (
            <button type="button" className="nowloc nowloc--off" onClick={share.start} title={share.state.phase === 'error' ? share.state.message : undefined}>
              <LocationIcon />
              {share.state.phase === 'error' ? t('Tentar ligar a localização') : t('Ligar localização')}
            </button>
          )}
          <button type="button" className="nowcard__stop" onClick={() => setConfirmOff(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
            </svg>
            {t('Parar o NOW')}
          </button>
        </div>
        {expiresAt ? <NowBar startsAt={status.data?.startsAt ?? null} expiresAt={expiresAt} /> : null}
      </section>
      {editingNote ? (
        <Sheet title={status.data?.note ? t('Editar recado') : t('Adicionar recado')} onClose={() => setEditingNote(false)}>
          <form
            className="nownote-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNote(noteDraft);
            }}
          >
            <label className="nownote nownote--input">
              <span className="visually-hidden">{t('Recado (opcional)')}</span>
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t('No que você tá a fim?')}
                maxLength={FLASH_NOTE_MAX + 20}
                autoComplete="off"
                autoFocus
                aria-invalid={noteError ? true : undefined}
                aria-describedby={noteError ? 'now-note-edit-error' : undefined}
              />
            </label>
            {noteError ? (
              <p className="nowoff__error" id="now-note-edit-error" role="alert">
                {noteError}
              </p>
            ) : noteDraft !== '' ? (
              <p className="nowoff__count">
                {Array.from(noteDraft).length}/{FLASH_NOTE_MAX}
              </p>
            ) : null}
            <Button full type="submit" disabled={savingNote}>
              {t('Salvar')}
            </Button>
            {status.data?.note ? (
              <Button full variant="secondary" type="button" disabled={savingNote} onClick={() => void saveNote('')}>
                {t('Tirar recado')}
              </Button>
            ) : null}
          </form>
        </Sheet>
      ) : null}
      {share.state.phase === 'error' ? <p className="muted nowcard__hint">{share.state.message}</p> : null}
      {confirmOff ? <Confirm question={t('Parar o NOW? Convites abertos e encontros em andamento serão encerrados.')} confirmLabel={t('Parar')} onConfirm={turnOff} onCancel={() => setConfirmOff(false)} busy={busy} danger /> : null}

      <section className="nowfree" aria-labelledby="livres-titulo">
        <div className="nowfree__row">
          <h2 id="livres-titulo" className="nowfree__title">
            {empty || available.data === undefined ? t('Amigos livres agora') : t('Amigos livres agora ({length})', { length: friends.length })}
          </h2>
          <button type="button" className={`nowfree__refresh${refreshing ? ' nowfree__refresh--busy' : ''}`} onClick={refreshNow} disabled={refreshing} aria-busy={refreshing || undefined}>
            <RefreshIcon />
            {refreshing ? t('Atualizando…') : t('Atualizar')}
          </button>
        </div>
        {available.loading && !available.data ? <Loading /> : null}
        {available.error && !available.data ? <ErrorState message={available.error.message} onRetry={available.reload} /> : null}
        {friends.length > 0 ? (
          <>
            <div className="nowsort" role="group" aria-label={t('Ordenar amigos')}>
              <button type="button" className="chip" aria-pressed={listMeta?.order === 'near'} disabled={listMeta !== undefined && !listMeta.nearAvailable} onClick={() => chooseOrder('near')}>
                {t('Mais perto')}
              </button>
              <button type="button" className="chip" aria-pressed={listMeta?.order === 'interaction'} onClick={() => chooseOrder('interaction')}>
                {t('Mais interação')}
              </button>
            </div>
            {listMeta && !listMeta.nearAvailable ? <p className="muted nowsort__hint">{t('Para ver quem está mais perto, libere a localização e ligue o NOW de novo.')}</p> : null}
            <ul className="nowfriends">
              {friends.map((f) => {
                const dir = f.invite?.direction;
                const state = dir === 'MATCHED' ? t('Encontro') : dir === 'SENT' ? t('Convidado') : dir === 'RECEIVED' ? t('Te chamou') : '';
                return (
                  <li key={f.profile.userId}>
                    <button
                      type="button"
                      className="nowfriend"
                      onClick={() => {
                        setMapFriend(f.profile.userId);
                        setMapOpen(true);
                      }}
                    >
                      <span className={`nownote nownote--light${f.note ? '' : ' nownote--none'}`}>{f.note ?? '.'}</span>
                      <NowFace profile={f.profile} size={52} />
                      <span className="nowfriend__name">{f.profile.username}</span>
                      <span className="nowfriend__detail">{[distanceOf(f), state].filter(Boolean).join(' · ') || ' '}</span>
                      <span className="visually-hidden">{t('Livre agora. Abrir opções.')}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="nowfree__actions">
              <button type="button" className="nowbtn nowbtn--ghost" onClick={() => setMapOpen(true)}>
                <MapIcon />
                {t('Ver no mapa')}
              </button>
              <button type="button" className="nowbtn nowbtn--ghost" disabled={eligible.length === 0} onClick={() => setCallAllOpen(true)}>
                <UsersIcon />
                {t('Chamar todos')}
              </button>
            </div>
          </>
        ) : empty ? (
          <div className="nowempty">
            <strong>{t('Ninguém livre por enquanto')}</strong>
            <span>{t('Pergunte a alguns amigos se estão livres. Quando ligarem o NOW, você fica sabendo.')}</span>
          </div>
        ) : null}
        <button type="button" className="nowask nowask--dashed" onClick={() => setAsking(true)}>
          <UserPlusIcon />
          {t('Perguntar se está livre')}
        </button>
        {empty ? (
          <button type="button" className="nowfree__invite" onClick={() => setInviting(true)}>
            {t('Chamar amigos para o AskouT')}
          </button>
        ) : null}
      </section>

      {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}
      {howSheet}
      {askSheet}
      {mapOpen ? (
        <FriendsMapSheet
          invites={received.map((invite) => (
            <InviteFocusCard key={invite.id} invite={invite} friend={friendById.get(invite.other.userId)} onDone={reloadAll} />
          ))}
          friends={friends}
          me={share.mine}
          exactById={exactById}
          selected={mapFriend}
          onSelect={setMapFriend}
          distanceOf={distanceOf}
          onChanged={reloadAll}
          onFeedback={setFeedback}
          onClose={() => {
            setMapOpen(false);
            setMapFriend(undefined);
          }}
        />
      ) : null}
      {callAllOpen ? (
        <Sheet title={t('Chamar todos')} onClose={() => (callingAll ? undefined : setCallAllOpen(false))}>
          <p>
            {eligible.length === 1 ? t('Enviar convite para 1 amigo que está livre agora? Cada convite vale por 15 minutos. Quem já foi convidado não recebe de novo.') : t('Enviar convite para {count} amigos que estão livres agora? Cada convite vale por 15 minutos. Quem já foi convidado não recebe de novo.', { count: eligible.length })}
          </p>
          <ul className="flashcall">
            {eligible.map((f) => (
              <li key={f.profile.userId}>{f.profile.username}</li>
            ))}
          </ul>
          <PrecisionPicker approx={approxAll} onChange={setApproxAll} text={t('Quem aceitar vai ver sua localização enquanto o encontro durar.')} />
          <Button full loading={callingAll} onClick={() => callAll()}>
            {t('Enviar convites')}
          </Button>
          <Button full variant="quiet" disabled={callingAll} onClick={() => setCallAllOpen(false)}>
            {t('Cancelar')}
          </Button>
        </Sheet>
      ) : null}
    </div>
  );
}

// ---------- Peças da tela do NOW ----------

/** Radar decorativo da tela desligada: você no meio, um ponteiro girando e fotos ilustrativas em volta. */
function NowRadar({ me }: { me: PublicProfile }) {
  return (
    <div className="nowradar" aria-hidden="true">
      <span className="nowradar__ring nowradar__ring--1" />
      <span className="nowradar__ring nowradar__ring--2" />
      <span className="nowradar__ring nowradar__ring--3" />
      <span className="nowradar__cross" />
      <span className="nowradar__sweep" />
      {/* Fotos ilustrativas: não são amigos disponíveis. */}
      {['a', 'b', 'c', 'd'].map((k) => (
        <span key={k} className={`nowradar__p nowradar__p--${k}`}>
          <img src={`/flash/${k}.jpg`} alt="" width="60" height="60" loading="lazy" decoding="async" />
        </span>
      ))}
      <span className="nowradar__me">
        <NowFace profile={me} size={84} />
      </span>
    </div>
  );
}

function NowClock({ expiresAt }: { expiresAt: string }) {
  const now = useTick(1000);
  return <b className="nowcard__clock">{formatClock(Date.parse(expiresAt) - now)}</b>;
}

/** Barra fina na borda de baixo do cartão: o tempo que resta do NOW. */
function NowBar({ startsAt, expiresAt }: { startsAt: string | null; expiresAt: string }) {
  const now = useTick(1000);
  const share = flashRemainingShare(startsAt, expiresAt, now);
  return (
    <span className="nowcard__bar" role="progressbar" aria-label={t('Tempo restante do NOW')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      <i style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
    </span>
  );
}

/** "Como funciona?": as regras do NOW em poucas linhas. */
function HowItWorks({ onClose }: { onClose: () => void }) {
  const rules: { icon: ReactNode; title: string; text: string }[] = [
    { icon: <UsersIcon />, title: t('Só amigos'), text: t('Só amigos (quem se segue de volta) veem que você está livre. Para ver quem está livre, você também liga o NOW.') },
    { icon: <ClockIcon />, title: t('Você escolhe o tempo'), text: t('De 30 minutos a 3 horas. No + do cartão dá para estender, e o quadrado para o NOW na hora.') },
    { icon: <ChatIcon />, title: t('Recado no balão'), text: t('O que você escrever aparece num balão na sua foto, só na tela do NOW e só para esses amigos.') },
    { icon: <BoltIcon filled />, title: t('Convites de 15 minutos'), text: t('Um convite chega como aviso no topo de qualquer tela. Toque em Bora! para abrir o encontro, ou em Agora não.') },
    { icon: <LocationIcon />, title: t('Localização sob controle'), text: t('No mapa, seus amigos veem só a região aproximada (uns 3 km) de onde você ligou. A posição exata vai só para quem aceitar sair com você, e você pode escolher mandar só a aproximada.') },
    { icon: <UserPlusIcon />, title: t('Perguntar se está livre'), text: t('Mande um aviso para amigos que estão com o NOW desligado. Quando ligarem, você fica sabendo. Um pedido por amigo a cada 3 horas.') },
  ];
  return (
    <Sheet title={t('Como o NOW funciona')} onClose={onClose}>
      <ul className="nowhow">
        {rules.map((r) => (
          <li key={r.title}>
            <span className="nowhow__icon" aria-hidden="true">
              {r.icon}
            </span>
            <span>
              <strong>{r.title}</strong>
              <span>{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** "Perguntar se está livre": escolhe amigos e manda um aviso que abre o NOW deles. */
function AskSheet({ onClose, onFeedback }: { onClose: () => void; onFeedback: (f: Feedback) => void }) {
  const friends = useAsync(() => api.friends(), []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const list = (friends.data ?? []).filter((p) => p.username.toLowerCase().includes(query.trim().toLowerCase()) || p.displayName.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  }

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.flashAsk([...picked]);
      onFeedback(
        result.asked.length === 0
          ? { tone: 'error', text: t('Ninguém recebeu agora: quem já está com o NOW ligado ou já recebeu um pedido seu nas últimas 3 horas fica de fora.') }
          : { tone: 'ok', text: result.asked.length === 1 ? t('Pedido enviado. Quando ligar o NOW, você fica sabendo.') : t('Pedido enviado para {count} amigos. Quando ligarem o NOW, você fica sabendo.', { count: result.asked.length }) },
      );
      onClose();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Perguntar se está livre')} onClose={() => (busy ? undefined : onClose())}>
      <p className="muted">{t('Cada amigo escolhido recebe um aviso perguntando se você está livre agora. Quando ligar o NOW, você é avisado.')}</p>
      <Field label={t('Buscar amigo')} hideLabel placeholder={t('Buscar amigo')} value={query} onChange={setQuery} autoComplete="off" />
      {friends.loading && !friends.data ? <Loading /> : null}
      {friends.error && !friends.data ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
      {friends.data && friends.data.length === 0 ? <p className="muted">{t('Você ainda não tem amigos no AskouT.')}</p> : null}
      <ul className="nowpick">
        {list.map((p) => (
          <li key={p.userId}>
            <button type="button" className="nowpick__item" aria-pressed={picked.has(p.userId)} onClick={() => toggle(p.userId)}>
              <NowFace profile={p} size={40} />
              <span className="nowpick__name">
                <strong>{p.username}</strong>
                <span>{p.displayName}</span>
              </span>
              <span className="nowpick__check" aria-hidden="true">
                {picked.has(p.userId) ? <CheckIcon /> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button full loading={busy} disabled={picked.size === 0} onClick={() => void send()}>
        {picked.size <= 1 ? t('Perguntar') : t('Perguntar a {count} amigos', { count: picked.size })}
      </Button>
    </Sheet>
  );
}

/** Mapa que sobe de baixo: fotos dos amigos livres (exatas para quem aceitou, aproximadas para os outros). */
function FriendsMapSheet({
  friends,
  me,
  exactById,
  selected,
  onSelect,
  distanceOf,
  onChanged,
  onFeedback,
  onClose,
  invites,
}: {
  /** Convites recebidos enquanto o mapa está aberto: ficam no topo da janela, para responder sem fechar o mapa. */
  invites?: ReactNode[];
  friends: readonly AvailableFriend[];
  me: { lat: number; lng: number } | undefined;
  exactById: Map<string, { lat: number; lng: number }>;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  distanceOf: (f: AvailableFriend) => string;
  onChanged: () => void;
  onFeedback: (f: Feedback) => void;
  onClose: () => void;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const pins: NowPin[] = [];
  for (const f of friends) {
    const exact = exactById.get(f.profile.userId);
    const at = exact ?? f.point ?? undefined;
    if (!at) continue;
    const photo = f.profile.avatarUrl ? (f.profile.avatarUrl.startsWith('/') ? api.assetUrl(f.profile.avatarUrl) : f.profile.avatarUrl) : null;
    const distance = distanceOf(f);
    pins.push({ id: f.profile.userId, lat: at.lat, lng: at.lng, name: f.profile.username, photo, initials: initials(f.profile.username), exact: exact !== undefined, label: exact ? f.profile.username : `${f.profile.username}${distance ? ` · ${distance}` : ''}` });
  }
  const chosen = friends.find((f) => f.profile.userId === selected);
  const hidden = friends.length - pins.length;
  return (
    <Sheet title={t('Amigos livres no mapa')} onClose={onClose}>
      {invites && invites.length > 0 ? <div className="nowmap__invites">{invites}</div> : null}
      <div className="nowmapwrap">
        {!mapFailed && (pins.length > 0 || me) ? (
          <Suspense fallback={<div className="matchmap matchmap--loading"><RingLoader size={72} label={t('Carregando o mapa')} /></div>}>
            <NowMap me={me} pins={pins} selected={selected} onSelect={onSelect} onFail={() => setMapFailed(true)} />
          </Suspense>
        ) : (
          <p className="muted">{mapFailed ? t('Não foi possível carregar o mapa agora.') : t('Ninguém ligou o NOW com localização por enquanto.')}</p>
        )}
        {chosen ? <MapFriendCard key={chosen.profile.userId} friend={chosen} exact={exactById.has(chosen.profile.userId)} distance={distanceOf(chosen)} onChanged={onChanged} onFeedback={onFeedback} onClose={() => onSelect(undefined)} /> : null}
      </div>
      <p className="nowmap__legend">
        <span>
          <i className="nowmap__dot nowmap__dot--exact" aria-hidden="true" />
          {t('Exata: aceitou sair com você')}
        </span>
        <span>
          <i className="nowmap__dot nowmap__dot--approx" aria-hidden="true" />
          {t('Aproximada: região de uns 3 km')}
        </span>
      </p>
      {hidden > 0 ? <p className="muted">{hidden === 1 ? t('1 amigo ligou sem localização e não aparece no mapa.') : t('{count} amigos ligaram sem localização e não aparecem no mapa.', { count: hidden })}</p> : null}
    </Sheet>
  );
}

/** Cartão sobre o mapa ao tocar num amigo: recado, distância e o que dá para fazer. */
function MapFriendCard({ friend, exact, distance, onChanged, onFeedback, onClose }: { friend: AvailableFriend; exact: boolean; distance: string; onChanged: () => void; onFeedback: (f: Feedback) => void; onClose: () => void }) {
  const [approx, setApprox] = useState(false);
  const [busy, setBusy] = useState(false);
  const { profile, invite } = friend;
  const left = minutesLeft(friend.expiresAt, Date.now());

  async function sendInvite() {
    setBusy(true);
    try {
      await api.flashInvite(profile.userId, approx);
      onFeedback({ tone: 'ok', text: t('Convite enviado para {username}. Vale por 15 minutos.', { username: profile.username }) });
      onChanged();
    } catch (failure) {
      onFeedback({ tone: 'error', text: toApiError(failure).message });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!invite) return;
    setBusy(true);
    try {
      await api.flashEnd(invite.id);
      onChanged();
    } catch (failure) {
      onFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nowfcard" role="group" aria-label={profile.username}>
      <button type="button" className="nowfcard__close" aria-label={t('Fechar')} onClick={onClose}>
        <XIcon />
      </button>
      <div className="nowfcard__top">
        <NowFace profile={profile} size={52} />
        <span className="nowfcard__who">
          <strong>{profile.username}</strong>
          <span>{[distance || (exact ? t('localização exata') : ''), t('livre por mais {left}', { left: formatRemaining(left) })].filter(Boolean).join(' · ')}</span>
          {friend.note ? <span className="nowfcard__tag">{friend.note}</span> : null}
        </span>
      </div>
      {invite === null ? (
        <div className="nowfcard__prec" role="radiogroup" aria-label={t('Como mostrar sua localização')}>
          <button type="button" role="radio" aria-checked={!approx} onClick={() => setApprox(false)}>
            {t('Exata')}
          </button>
          <button type="button" role="radio" aria-checked={approx} onClick={() => setApprox(true)}>
            {t('Aproximada')}
          </button>
        </div>
      ) : null}
      <div className="nowfcard__act">
        {invite?.direction === 'MATCHED' ? (
          <Link to={`/now/encontro/${invite.id}`} className="nowbtn nowbtn--yes">
            {t('Ver encontro')}
          </Link>
        ) : invite?.direction === 'SENT' ? (
          <button type="button" className="nowbtn nowbtn--no" disabled={busy} aria-busy={busy || undefined} onClick={() => void cancel()}>
            {t('Cancelar convite')}
          </button>
        ) : invite?.direction === 'RECEIVED' ? (
          <button type="button" className="nowbtn nowbtn--yes" onClick={onClose}>
            {t('Responder convite')}
          </button>
        ) : (
          <button type="button" className="nowbtn nowbtn--yes" disabled={busy} aria-busy={busy || undefined} onClick={() => void sendInvite()}>
            {t('Convidar')}
          </button>
        )}
        <ChatButton userId={profile.userId} small label={t('Conversar')} />
        <Link to={`/u/${encodeURIComponent(profile.username)}`} className="btn btn--secondary btn--small">
          {t('Ver perfil')}
        </Link>
      </div>
    </div>
  );
}

// ---------- Cartão do Flash ligado ----------

// ---------- Linhas ----------

function BlockAction({ profile, onDone, onFeedback }: { profile: PublicProfile; onDone: () => void; onFeedback: (f: Feedback) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function block() {
    setBusy(true);
    try {
      await api.block(profile.userId);
      onFeedback({ tone: 'ok', text: t('Você bloqueou {username}. Ele não vê mais você e vocês deixam de ser amigos.', { username: profile.username }) });
      onDone();
    } catch (failure) {
      onFeedback({ tone: 'error', text: toApiError(failure).message });
      setBusy(false);
      setAsking(false);
    }
  }

  if (!asking) {
    return (
      <Button small variant="quiet" onClick={() => setAsking(true)}>
        {t('Bloquear')}
      </Button>
    );
  }
  return (
    <Confirm
      question={t('Bloquear {username}? Vocês deixam de ser amigos e nenhum dos dois vê o outro.', { username: profile.username })}
      confirmLabel={t('Bloquear')}
      onConfirm={block}
      onCancel={() => setAsking(false)}
      busy={busy}
      danger
    />
  );
}

/** Escolha entre mostrar a localização exata ou só a aproximada (~3 km). */
function PrecisionPicker({ approx, onChange, text, disabled }: { approx: boolean; onChange: (approx: boolean) => void; text: string; disabled?: boolean }) {
  return (
    <div className="flashchoice">
      <p className="flashchoice__text">
        <LocationIcon />
        <span>{text}</span>
      </p>
      <div className="flashchoice__opts" role="radiogroup" aria-label={t('Como mostrar sua localização')}>
        <button type="button" role="radio" aria-checked={!approx} className="flashchoice__opt" disabled={disabled} onClick={() => onChange(false)}>
          <strong>{t('Exata')}</strong>
          <span>{t('Vê onde você está')}</span>
        </button>
        <button type="button" role="radio" aria-checked={approx} className="flashchoice__opt" disabled={disabled} onClick={() => onChange(true)}>
          <strong>{t('Aproximada')}</strong>
          <span>{t('Só a região, uns 3 km')}</span>
        </button>
      </div>
    </div>
  );
}

// ---------- Encontro ----------

type ShareState =
  | { phase: 'idle' }
  | { phase: 'asking' }
  | { phase: 'sharing'; accuracyM?: number; lastSentAt?: number }
  | { phase: 'error'; message: string };

const SEND_EVERY_MS = 10_000;

/** Acompanha a posição do aparelho e envia a cada encontro aceito. Só começa quando a pessoa toca no botão. */
function useShareLocation(inviteIds: readonly string[], onEnded: () => void, auto = false) {
  const [state, setState] = useState<ShareState>({ phase: 'idle' });
  const [mine, setMine] = useState<{ lat: number; lng: number } | undefined>();
  const watchId = useRef<number | undefined>(undefined);
  const lastSent = useRef(0);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const idsRef = useRef(inviteIds);
  idsRef.current = inviteIds;
  // Quem pede para parar não é religado sozinho.
  const stoppedByUser = useRef(false);

  function stop() {
    stoppedByUser.current = true;
    if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = undefined;
    setMine(undefined);
    setState({ phase: 'idle' });
  }

  function start(highAccuracy = true) {
    stoppedByUser.current = false;
    if (!('geolocation' in navigator)) {
      setState({ phase: 'error', message: geolocationMessage(undefined, window.isSecureContext) });
      return;
    }
    if (!window.isSecureContext) {
      setState({ phase: 'error', message: geolocationMessage(undefined, false) });
      return;
    }
    setState({ phase: 'asking' });
    lastSent.current = 0;
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setMine({ lat: latitude, lng: longitude });
        const now = Date.now();
        setState((current) => (current.phase === 'error' ? current : { phase: 'sharing', accuracyM: Math.round(accuracy), lastSentAt: current.phase === 'sharing' ? current.lastSentAt : undefined }));
        if (now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        // Sem nenhum encontro aceito não há para quem enviar: o ponto aparece só para você.
        Promise.allSettled(
          idsRef.current.map((id) => api.flashShareLocation(id, { lat: latitude, lng: longitude, accuracyM: Math.round(accuracy) })),
        ).then((results) => {
          setState((current) => (current.phase === 'sharing' ? { ...current, lastSentAt: Date.now() } : current));
          if (results.some((r) => r.status === 'rejected' && toApiError(r.reason).code === 'NOT_FOUND')) endedRef.current();
        });
      },
      (failure) => {
        if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = undefined;
        // Computador sem GPS costuma estourar o tempo no modo preciso: tenta de novo no modo comum (Wi-Fi/rede).
        if (highAccuracy && failure.code !== 1) {
          start(false);
          return;
        }
        setState({ phase: 'error', message: geolocationMessage(failure.code, true) });
      },
      { enableHighAccuracy: highAccuracy, maximumAge: highAccuracy ? 5_000 : 60_000, timeout: 20_000 },
    );
  }

  // Começa sozinho (o navegador ainda pede a permissão do aparelho). Só é enviada para os encontros aceitos.
  useEffect(() => {
    if (auto && !stoppedByUser.current && state.phase === 'idle') start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, state.phase]);

  // Bloqueada no navegador: nenhum site consegue perguntar de novo. Quando a pessoa libera nas configurações, liga sozinho.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms?.query) return undefined;
    let status: PermissionStatus | undefined;
    let cancelled = false;
    const onChange = () => {
      if (status?.state === 'granted' && stateRef.current.phase === 'error' && !stoppedByUser.current) start();
    };
    perms
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener('change', onChange);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desligou (ex.: o NOW acabou): para de ler a posição e volta a ligar sozinho da próxima vez.
  useEffect(() => {
    if (auto) return;
    if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = undefined;
    stoppedByUser.current = false;
    setMine(undefined);
    setState({ phase: 'idle' });
  }, [auto]);

  useEffect(
    () => () => {
      if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return { state, mine, start: () => start(), stop };
}

export function MatchScreen({ inviteId }: { inviteId: string }) {
  useTitle(t('Encontro'));
  const match = useAsync(() => api.flashMatch(inviteId), [inviteId]);
  usePolling(match.reload, 8_000);

  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const share = useShareLocation([inviteId], match.reload, match.data !== undefined);
  const [mapFailed, setMapFailed] = useState(false);
  const [pickedKey, setPickedKey] = useState<string | undefined>();
  const [mode, setMode] = useState<'foot' | 'driving'>('foot');
  const [destBusy, setDestBusy] = useState(false);
  const [precisionBusy, setPrecisionBusy] = useState(false);

  async function changePrecision(approx: boolean) {
    if (approx === (match.data?.meApprox === true)) return;
    setPrecisionBusy(true);
    setFeedback(undefined);
    try {
      await api.flashSetPrecision(inviteId, approx);
      match.reload();
      setFeedback({ tone: 'ok', text: approx ? t('Agora só a sua localização aproximada é mostrada.') : t('Agora sua localização exata é mostrada.') });
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setPrecisionBusy(false);
    }
  }

  // Bares e eventos entre os dois: só quando os dois já compartilharam a localização.
  const bothShared = Boolean(match.data?.me && match.data?.them);
  const radiusKm = nowRadiusKm();
  const suggestions = useAsync(() => (bothShared ? api.flashSuggestions(inviteId, radiusKm) : Promise.resolve(undefined)), [inviteId, bothShared, radiusKm]);
  usePolling(suggestions.reload, 60_000, bothShared);
  // Rota de cada um até o lugar escolhido; some se ninguém escolheu.
  const dest = match.data?.destination ?? null;
  const routes = useAsync(() => (dest ? api.flashRoutes(inviteId, mode) : Promise.resolve(undefined)), [inviteId, mode, dest?.lat, dest?.lng]);
  usePolling(routes.reload, 20_000, dest !== null);

  if (match.loading && !match.data && !match.error) return <Loading />;
  if (match.error && !match.data) {
    if (match.error.code === 'NOT_FOUND') {
      return (
        <>
          <PageHead title={t('Encontro')} back="/now" />
          <EmptyState
            title={t('Este encontro acabou')}
            action={
              <Link to="/now" className="btn btn--primary">
                {t('Voltar ao NOW')}
              </Link>
            }
          >
            {t('O convite venceu, alguém encerrou ou o NOW foi desligado. A localização compartilhada já foi apagada.')}
          </EmptyState>
        </>
      );
    }
    return <ErrorState message={match.error.message} onRetry={match.reload} />;
  }
  const data = match.data as FlashMatch;

  async function endMatch() {
    setBusy(true);
    try {
      share.stop();
      await api.flashEnd(inviteId);
      navigate('/now');
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
      setBusy(false);
    }
  }

  async function chooseDestination(item: SuggestionItem) {
    setDestBusy(true);
    setFeedback(undefined);
    try {
      await api.flashChooseDestination(inviteId, { name: placeName(item), lat: item.lat, lng: item.lng });
      setPickedKey(undefined);
      match.reload();
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setDestBusy(false);
    }
  }

  async function suggestPlace(place: { name: string; lat: number; lng: number }) {
    setDestBusy(true);
    setFeedback(undefined);
    try {
      await api.flashChooseDestination(inviteId, place);
      setPickedKey(undefined);
      match.reload();
      setFeedback({ tone: 'ok', text: t('{place} sugerido para {name}.', { place: place.name, name: data.other.username }) });
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setDestBusy(false);
    }
  }

  async function clearDestination() {
    setDestBusy(true);
    try {
      await api.flashClearDestination(inviteId);
      match.reload();
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setDestBusy(false);
    }
  }

  const places = sortByFairness(suggestions.data?.items ?? []).slice(0, MAX_PLACES_ON_MAP);
  const placePins: PlacePin[] = places.map((p) => ({ key: p.key, name: placeName(p), lat: p.lat, lng: p.lng }));
  const left = minutesLeft(data.expiresAt, Date.parse(data.now));
  const them = data.them;
  const myPoint = share.mine ?? (data.me ? { lat: data.me.lat, lng: data.me.lng } : undefined);
  const distance = them && myPoint ? distanceMeters(myPoint, them) : undefined;
  const routeLines: { me?: RouteLine | undefined; them?: RouteLine | undefined } | undefined =
    dest && routes.data
      ? {
          ...(myPoint && routes.data.me ? { me: { from: myPoint, line: routes.data.me.line } } : {}),
          ...(them && routes.data.them ? { them: { from: { lat: them.lat, lng: them.lng }, line: routes.data.them.line } } : {}),
        }
      : undefined;

  return (
    <>
      <PageHead title={data.other.username} back="/now" subtitle={t('Encontro NOW · acaba em {left}', { left: formatRemaining(left) })} />
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

      <section className="whereis" aria-label={t('Onde {username} está', { username: data.other.username })}>
        <Avatar profile={data.other} size={56} />
        {!them ? (
          <>
            <p className="whereis__main">{t('Ainda sem localização')}</p>
            <p className="muted">{t('{name} ainda não compartilhou. Assim que compartilhar, a distância aparece aqui.', { name: data.other.username })}</p>
          </>
        ) : them.stale ? (
          <>
            <p className="whereis__main">{t('Sem sinal')}</p>
            <p className="muted">
              {t('A última localização de {name} foi {when}. Ela volta quando o sinal voltar.', { name: data.other.username, when: formatAge(them.updatedAt, data.now) })}
            </p>
          </>
        ) : (
          <>
            <p className="whereis__main">
              {distance === undefined
                ? t('Localização recebida')
                : data.themApprox
                  ? t('a uns {km} km de você', { km: Math.max(3, Math.round(distance / 1000)) })
                  : t('a {distance} de você', { distance: formatDistance(distance) })}
            </p>
            <p className="muted">{t('Atualizado {when}.', { when: formatAge(them.updatedAt, data.now) })}{data.themApprox ? t(' Localização aproximada (uns 3 km).') : ''}{distance === undefined ? t(' Compartilhe a sua para ver a distância.') : ''}</p>
          </>
        )}
        {them ? (
          <OpenInMaps className="whereis__link" lat={them.lat} lng={them.lng}>
            {t('Abrir no mapa')}
          </OpenInMaps>
        ) : null}
      </section>

      {!mapFailed && (them || myPoint) ? (
        <Suspense fallback={<div className="matchmap matchmap--loading"><RingLoader size={72} label={t('Carregando o mapa')} /></div>}>
          <MatchMap
            me={myPoint}
            others={
              them ? [{ id: inviteId, lat: them.lat, lng: them.lng, stale: them.stale, initials: initials(data.other.username) }] : []
            }
            places={dest ? [] : placePins}
            selectedKey={pickedKey}
            onPick={setPickedKey}
            destination={dest ? { lat: dest.lat, lng: dest.lng, name: dest.name } : undefined}
            routes={routeLines}
            onFail={() => setMapFailed(true)}
          />
        </Suspense>
      ) : null}

      {dest ? (
        <MatchDestination match={data} mode={mode} onMode={setMode} me={routes.data?.me} them={routes.data?.them} routesLoading={routes.loading} busy={destBusy} onClear={() => void clearDestination()} />
      ) : null}
      <MatchPlaces
        bothShared={bothShared}
        loading={suggestions.loading}
        error={suggestions.error && suggestions.error.code !== 'CONFLICT' ? suggestions.error.message : undefined}
        suggestions={suggestions.data}
        places={dest ? places.filter((p) => placeName(p) !== dest.name) : places}
        otherName={data.other.username}
        selectedKey={pickedKey}
        busy={destBusy}
        onSelect={setPickedKey}
        onChoose={(item) => void chooseDestination(item)}
      />
      {suggestions.data ? (
        <p className="muted matchradius">
          {radiusKm === null
            ? t('Buscando até {km} km do meio do caminho (automático).', { km: Math.round(suggestions.data.radiusM / 100) / 10 })
            : t('Buscando até {km} km do meio do caminho.', { km: radiusKm })}{' '}
          <Link to="/configuracao/now">{t('Mudar')}</Link>
        </p>
      ) : null}
      <MatchPlaceSearch center={myPoint ?? (them ? { lat: them.lat, lng: them.lng } : undefined)} otherName={data.other.username} busy={destBusy} onSuggest={(place) => void suggestPlace(place)} />

      <section className="sharebox" aria-label={t('Sua localização')}>
        <PrecisionPicker approx={data.meApprox === true} disabled={precisionBusy} onChange={(approx) => void changePrecision(approx)} text={t('{name} vê sua localização {how}.', { name: data.other.username, how: data.meApprox ? t('aproximada') : t('exata') })} />
        {share.state.phase === 'sharing' ? (
          <>
            <p className="sharebox__title">{t('Compartilhando sua localização')}</p>
            <p className="muted">
              {data.meApprox
                ? t('{name} vê só a região onde você está, uns 3 km. ', { name: data.other.username })
                : share.state.accuracyM !== undefined
                  ? t('Precisão de cerca de {accuracyM} m. ', { accuracyM: share.state.accuracyM })
                  : ''}
              Mantenha esta tela aberta; ao sair, o envio para.
            </p>
            <Button variant="secondary" full onClick={share.stop}>
              {t('Parar de compartilhar')}
            </Button>
          </>
        ) : (
          <>
            <p className="sharebox__title">{t('Mostrar onde estou')}</p>
            <p className="muted">{t('Só {name} vê sua localização, só durante este encontro, e ela some quando ele acabar. Ao aceitar o convite, o envio começa sozinho.', { name: data.other.username })}</p>
            {share.state.phase === 'error' ? <Notice tone="error">{share.state.message}</Notice> : null}
            <Button full loading={share.state.phase === 'asking'} onClick={share.start}>
              {t('Compartilhar minha localização')}
            </Button>
          </>
        )}
      </section>

      <div className="stack">
        <Link to={`/conversas/${data.conversationId}`} className="btn btn--primary btn--full">
          {t('Conversar e sugerir um local')}
        </Link>
        {confirmEnd ? (
          <Confirm question={t('Encerrar o encontro? A localização dos dois deixa de ser compartilhada.')} confirmLabel={t('Encerrar')} onConfirm={endMatch} onCancel={() => setConfirmEnd(false)} busy={busy} danger />
        ) : (
          <Button variant="secondary" full onClick={() => setConfirmEnd(true)}>
            {t('Encerrar encontro')}
          </Button>
        )}
        <BlockAction profile={data.other} onDone={() => navigate('/now')} onFeedback={setFeedback} />
      </div>
    </>
  );
}
