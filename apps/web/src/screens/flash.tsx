import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BoltIcon, CalendarIcon, ChatIcon, ChevronRightIcon, ClockIcon, HelpIcon, LocationIcon, LockIcon, RefreshIcon, ShieldIcon, UserPlusIcon, UsersIcon, BulbIcon } from '../components/icons.tsx';
import { Sheet } from '../components/agenda.tsx';
import { RingLoader } from '../components/ring-loader.tsx';
import { ChatButton } from '../components/chat-button.tsx';
import { InviteSheet } from '../components/invite.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import {
  announceFlashChange,
  distanceMeters,
  FLASH_DEFAULT_MINUTES,
  formatFlashDuration,
  FLASH_NOTE_MAX,
  flashNoteProblem,
  flashRemainingShare,
  formatAge,
  formatCountdown,
  formatDistance,
  formatKm,
  formatRemaining,
  geolocationMessage,
  minutesLeft,
} from '../lib/flash.ts';
import { birthDateProblem, todayIso } from '../lib/age.ts';
import { initials, tintIndex } from '../lib/avatar.ts';
import { toApiError } from '../lib/errors.ts';
import { FLASH_PRIVACY_POINTS, flashNoticeSeen, markFlashNoticeSeen, safeStorage } from '../lib/hints.ts';
import type { OtherPin } from '../components/match-map.tsx';
import type { AvailableFriend, FlashInvite, FlashMatch, PublicProfile } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';

const POLL_MS = 10_000;
/** Durações oferecidas ao ligar o Flash (a API aceita de 5 min a 3 h). */
const DURATIONS: readonly { minutes: number; value: string; unit: string; label: string }[] = [
  { minutes: 30, value: '30', unit: 'min', label: '30 minutos' },
  { minutes: 60, value: '1', unit: 'hora', label: '1 hora' },
  { minutes: 120, value: '2', unit: 'horas', label: '2 horas' },
  { minutes: 180, value: '3', unit: 'horas', label: '3 horas' },
];

// O mapa (MapLibre) é pesado: só é baixado quando alguém abre um encontro.
const MatchMap = lazy(() => import('../components/match-map.tsx'));

type Feedback = { tone: 'ok' | 'error'; text: string } | undefined;

// ---------- Trava de idade ----------

function AgeGate({ declared, onDone }: { declared: boolean; onDone: () => void }) {
  const [birth, setBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = birthDateProblem(birth, new Date());
    if (problem) {
      setError(problem);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await api.declareAge(birth);
      onDone();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Flash" />
      <div className="agegate">
        <span className="agegate__icon" aria-hidden="true">
          <BoltIcon />
        </span>
        {declared ? (
          <>
            <h2 className="agegate__title">O Flash é só para maiores de 18 anos</h2>
            <p className="agegate__text">Pela data de nascimento que você informou, você ainda não pode usar o Flash. O resto do AskouT continua liberado.</p>
          </>
        ) : (
          <>
            <h2 className="agegate__title">Confirme que você tem 18 anos ou mais</h2>
            <p className="agegate__text">O Flash mostra quem está disponível para sair agora, por isso é só para maiores de idade. Informe sua data de nascimento. Ela não aparece para ninguém. Se errar, você corrige em Editar perfil.</p>
            <form className="form" onSubmit={(e) => void submit(e)} noValidate>
              <Field label="Data de nascimento" type="date" value={birth} onChange={setBirth} error={error} max={todayIso()} autoComplete="bday" />
              <Button type="submit" full loading={busy}>
                Confirmar
              </Button>
            </form>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Tela do Flash ----------

/** Flash é só para maiores de 18 anos: antes de tudo, confere a idade (a API confere de novo). */
export function FlashScreen() {
  useTitle('Flash');
  const age = useAsync(() => api.ageStatus(), []);
  if (age.loading && !age.data) return <Loading />;
  if (age.error && !age.data) return <ErrorState message={age.error.message} onRetry={age.reload} />;
  if (!age.data?.adult) return <AgeGate declared={age.data?.declared === true} onDone={age.reload} />;
  return <FlashContent />;
}

function FlashContent() {
  const status = useAsync(() => api.flashStatus(), []);
  const active = status.data?.active === true;
  const available = useAsync(() => (active ? api.flashAvailable().then((r) => r.items) : Promise.resolve([] as AvailableFriend[])), [active]);
  const invites = useAsync(() => api.flashInvites(), []);

  // Mapa: onde estão os amigos que aceitaram sair com você (e só eles).
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
    active && matchIds.length > 0,
  );
  const [mapFailed, setMapFailed] = useState(false);

  const [minutes, setMinutes] = useState(FLASH_DEFAULT_MINUTES);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [started, setStarted] = useState<string | undefined>();
  const [mapOpen, setMapOpen] = useState(false);
  const [friendOpen, setFriendOpen] = useState<string | undefined>();
  const [callAllOpen, setCallAllOpen] = useState(false);
  const [callingAll, setCallingAll] = useState(false);
  const [inviting, setInviting] = useState(false);

  // O aviso de "Flash ativado" some sozinho depois de 3 segundos.
  useEffect(() => {
    if (!started) return undefined;
    const timer = window.setTimeout(() => setStarted(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [started]);

  // O tempo restante e as listas se atualizam sozinhos.
  const [, setTick] = useState(0);
  usePolling(() => {
    status.reload();
    invites.reload();
    available.reload();
    matchViews.reload();
    setTick((n) => n + 1);
  }, POLL_MS);

  function reloadAll() {
    status.reload();
    invites.reload();
    available.reload();
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
      const next = await api.flashOn(minutes, note.trim());
      status.setData(next);
      const until = next.expiresAt ? new Date(next.expiresAt) : new Date(Date.now() + minutes * 60_000);
      setStarted(`${formatFlashDuration(minutes)}, até ${until.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
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

  async function turnOff() {
    setBusy(true);
    setFeedback(undefined);
    try {
      await api.flashOff();
      setConfirmOff(false);
      setNote('');
      reloadAll();
      announceFlashChange();
      setFeedback({ tone: 'ok', text: 'Flash desligado. Seus convites foram cancelados.' });
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  if (status.loading && !status.data) return <Loading />;
  if (status.error && !status.data) return <ErrorState message={status.error.message} onRetry={status.reload} />;

  const now = Date.now();
  const left = status.data?.expiresAt ? minutesLeft(status.data.expiresAt, now) : 0;
  const received = invites.data?.received ?? [];
  const matches = invites.data?.matches ?? [];
  const mapOthers: OtherPin[] = (matchViews.data ?? []).flatMap((m) =>
    m.them ? [{ id: m.inviteId, lat: m.them.lat, lng: m.them.lng, stale: m.them.stale, initials: initials(m.other.username) }] : [],
  );

  const friends = available.data ?? [];
  // Tela nova: Flash ligado e com ao menos um amigo livre. Os outros estados seguem como estavam.
  const rich = active && friends.length > 0;
  // Flash ligado e a lista já chegou vazia: mostra o estado "ninguém por enquanto" (e não o painel antigo).
  const empty = active && available.data !== undefined && friends.length === 0;
  const eligible = friends.filter((f) => f.invite === null);
  // Distância só de quem aceitou o convite e já enviou a posição. Parte da minha posição enviada ao encontro
  // (ou da que o aparelho está lendo agora); sem as duas pontas, nada é mostrado.
  const distanceById = new Map<string, string>();
  for (const m of matchViews.data ?? []) {
    const origin = m.me ?? share.mine;
    if (m.them && origin) distanceById.set(m.other.userId, formatKm(distanceMeters(origin, m.them)));
  }
  const friendInSheet = friends.find((f) => f.profile.userId === friendOpen);

  async function callAll() {
    setCallingAll(true);
    setFeedback(undefined);
    const results = await Promise.allSettled(eligible.map((f) => api.flashInvite(f.profile.userId)));
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - sent;
    setCallingAll(false);
    setCallAllOpen(false);
    setFeedback(
      failed === 0
        ? { tone: 'ok', text: sent === 1 ? 'Convite enviado. Vale por 15 minutos.' : `${sent} convites enviados. Valem por 15 minutos.` }
        : { tone: 'error', text: `${sent} de ${results.length} convites enviados. Os outros não puderam ser enviados agora.` },
    );
    reloadAll();
  }

  const mapSection = (
    <section className="section" aria-labelledby="mapa-titulo">
      <h2 id="mapa-titulo" className="section__title">
        No mapa
      </h2>
      {!mapFailed && (share.mine || mapOthers.length > 0) ? (
        <Suspense fallback={<div className="matchmap matchmap--loading"><RingLoader size={72} label="Carregando o mapa" /></div>}>
          <MatchMap me={share.mine} others={mapOthers} onFail={() => setMapFailed(true)} />
        </Suspense>
      ) : null}
      <p className="muted">
        {matches.length === 0
          ? 'Só aparecem aqui você e os amigos que aceitaram sair com você. Convide alguém da lista abaixo.'
          : mapOthers.length === 0
            ? 'Seus amigos aparecem no mapa quando compartilharem a localização.'
            : 'Amigos que aceitaram sair com você, atualizados a cada poucos segundos.'}
      </p>
      {share.state.phase === 'sharing' ? (
        <Button variant="secondary" full onClick={share.stop}>
          Parar de compartilhar
        </Button>
      ) : (
        <>
          {share.state.phase === 'error' ? <Notice tone="error">{share.state.message}</Notice> : null}
          <Button full loading={share.state.phase === 'asking'} onClick={share.start}>
            Compartilhar minha localização
          </Button>
          <p className="muted">Sua localização só vai para quem aceitou sair com você, enquanto este Flash estiver ligado.</p>
        </>
      )}
      <p className="muted">Quando alguém aceita um convite, vocês dois passam a compartilhar a localização automaticamente. Dá para parar quando quiser.</p>
    </section>
  );

  const receivedBlock =
    received.length > 0 ? (
      <section className="section" aria-labelledby="recebidos-titulo">
        <h2 id="recebidos-titulo" className="section__title">
          Convites para você
        </h2>
        <ul className="list">
          {received.map((invite) => (
            <InviteRow key={invite.id} invite={invite} canAccept={active} onChanged={reloadAll} onFeedback={setFeedback} />
          ))}
        </ul>
      </section>
    ) : null;

  const matchesBlock =
    matches.length > 0 ? (
      <section className="section" aria-labelledby="encontros-titulo">
        <h2 id="encontros-titulo" className="section__title">
          Encontros em andamento
        </h2>
        <ul className="list">
          {matches.map((invite) => (
            <li key={invite.id} className="person">
              <Link to={`/flash/encontro/${invite.id}`} className="person__link">
                <Avatar profile={invite.other} />
                <span className="person__body">
                  <span className="person__name">{invite.other.username}</span>
                  <span className="person__handle">Aceitou sair com você</span>
                </span>
              </Link>
              <div className="person__aside row-actions">
                <ChatButton userId={invite.other.userId} variant="primary" small />
                <Link to={`/flash/encontro/${invite.id}`} className="btn btn--secondary btn--small">
                  Mapa
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  if (rich || empty) {
    return (
      <div className="flashlive">
        {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
        {started ? (
          <div className="flashtoast" role="status">
            <span className="flashtoast__bolt">
              <BoltIcon filled />
            </span>
            <strong>Flash ativado</strong>
            <span>{started}</span>
          </div>
        ) : null}
        <header className="flashlive__head">
          <h1 className="flashlive__title">
            Flash <BoltIcon filled />
          </h1>
          <p className="flashlive__sub">Você está disponível agora.</p>
        </header>

        <section className="flashcard" aria-label="Seu Flash">
          <div className="flashcard__top">
            <span className="flashcard__icon">
              <BoltIcon filled />
            </span>
            <div className="flashcard__text">
              <p className="flashcard__title">Flash ativo</p>
              <p className="flashcard__status">
                {status.data?.expiresAt ? (
                  <>
                    Faltam <Countdown expiresAt={status.data.expiresAt} />
                  </>
                ) : null}
              </p>
            </div>
          </div>
          {status.data?.expiresAt ? <FlashBar startsAt={status.data.startsAt} expiresAt={status.data.expiresAt} /> : null}
          {status.data?.note ? <p className="flashcard__note">“{status.data.note}”</p> : null}
          {confirmOff ? (
            <Confirm question="Desligar o Flash? Convites abertos e encontros em andamento serão encerrados." confirmLabel="Desligar" onConfirm={turnOff} onCancel={() => setConfirmOff(false)} busy={busy} danger />
          ) : (
            <div className="flashcard__foot">
              <span className="flashcard__visible">
                <UsersIcon />
                Visível para seus amigos
              </span>
              <button type="button" className="flashcard__off" onClick={() => setConfirmOff(true)}>
                <span className="flashcard__stop" aria-hidden="true" />
                Desligar
              </button>
            </div>
          )}
        </section>

        <section className="flashlive__section" aria-labelledby="livres-titulo">
          <div className="flashlive__row">
            <h2 id="livres-titulo" className="flashlive__h2">
              {empty ? 'Amigos livres agora' : `Amigos livres agora (${friends.length})`}
            </h2>
            <button type="button" className="flashlive__refresh" onClick={reloadAll}>
              <RefreshIcon />
              Atualizar
            </button>
          </div>
          {empty ? (
          <div className="flashempty">
              <span className="flashempty__icon" aria-hidden="true">
                <UsersIcon />
              </span>
              <h3 className="flashempty__title">Ninguém disponível por enquanto</h3>
              <p className="flashempty__text">Que tal chamar seus amigos para ligar o Flash também?</p>
              <button type="button" className="flashempty__cta" onClick={() => setInviting(true)}>
                <UserPlusIcon />
                Convidar amigos
              </button>
          </div>
          ) : (
            <>
              <ul className="flashfriends">
                {friends.map((f) => {
                  const dir = f.invite?.direction;
                  const detail = distanceById.get(f.profile.userId) ?? (dir === 'MATCHED' ? 'Encontro' : dir === 'SENT' ? 'Convidado' : dir === 'RECEIVED' ? 'Convidou você' : '');
                  return (
                    <li key={f.profile.userId}>
                      <button type="button" className="flashfriend" onClick={() => setFriendOpen(f.profile.userId)}>
                        <span className="flashfriend__ring">
                          {f.profile.avatarUrl ? (
                            <img className="flashfriend__img" src={f.profile.avatarUrl.startsWith('/') ? api.assetUrl(f.profile.avatarUrl) : f.profile.avatarUrl} alt="" referrerPolicy="no-referrer" />
                          ) : (
                            <span className={`flashfriend__img avatar--tint-${tintIndex(f.profile.username)}`} aria-hidden="true">
                              {initials(f.profile.username)}
                            </span>
                          )}
                          <span className="flashfriend__on" aria-hidden="true" />
                        </span>
                        <span className="flashfriend__name">{f.profile.username}</span>
                        <span className="flashfriend__detail">{detail || ' '}</span>
                        <span className="visually-hidden">Livre agora. Abrir opções.</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="flashlive__map" onClick={() => setMapOpen(true)}>
                <LocationIcon />
                Ver no mapa
              </button>
            </>
          )}
        </section>

        {!empty ? (
          <>
            <section className="flashlive__section" aria-labelledby="acoes-titulo">
              <h2 id="acoes-titulo" className="flashlive__h2">
                Ações rápidas
              </h2>
              <div className="flashquick">
                <button type="button" className="flashquick__item" disabled={eligible.length === 0} onClick={() => setCallAllOpen(true)}>
                  <UsersIcon />
                  Chamar todos
                </button>
                <Link to="/criar" className="flashquick__item">
                  <CalendarIcon />
                  Criar evento agora
                </Link>
                <Link to="/conversas" className="flashquick__item">
                  <ChatIcon />
                  Ver conversas
                </Link>
              </div>
            </section>

            <button type="button" className="flashprivacy" onClick={() => setInfoOpen(true)}>
              <ShieldIcon />
              <span>Sua localização é compartilhada apenas com amigos que você autorizar.</span>
              <ChevronRightIcon />
            </button>
          </>
        ) : (
          <div className="flashtip">
            <span className="flashtip__icon" aria-hidden="true">
              <BulbIcon />
            </span>
            <div>
              <p className="flashtip__title">Dica</p>
              <p className="flashtip__text">Quanto mais amigos usarem o Flash, maiores as <strong>chances</strong> de encontrar alguém para sair.</p>
            </div>
          </div>
        )}

        {receivedBlock}
        {matchesBlock}

        {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}
        {infoOpen ? (
          <Sheet title="Como o Flash funciona" onClose={() => setInfoOpen(false)}>
            <p>Seus amigos que também estiverem com Flash ligado veem seu nome e sua foto.</p>
            <p>Sua localização só é compartilhada com quem aceitar sair com você.</p>
          </Sheet>
        ) : null}
        {mapOpen ? (
          <Sheet title="Ver no mapa" onClose={() => setMapOpen(false)}>
            {mapSection}
          </Sheet>
        ) : null}
        {friendInSheet ? (
          <Sheet title={friendInSheet.profile.username} onClose={() => setFriendOpen(undefined)}>
            <ul className="list">
              <AvailableRow friend={friendInSheet} onChanged={reloadAll} onFeedback={setFeedback} />
            </ul>
          </Sheet>
        ) : null}
        {callAllOpen ? (
          <Sheet title="Chamar todos" onClose={() => (callingAll ? undefined : setCallAllOpen(false))}>
            <p>
              Enviar convite para {eligible.length === 1 ? '1 amigo que está livre' : `${eligible.length} amigos que estão livres`} agora? Cada convite vale por 15 minutos. Quem já foi convidado não recebe de novo.
            </p>
            <ul className="flashcall">
              {eligible.map((f) => (
                <li key={f.profile.userId}>{f.profile.username}</li>
              ))}
            </ul>
            <Button full loading={callingAll} onClick={() => void callAll()}>
              Enviar convites
            </Button>
            <Button full variant="quiet" disabled={callingAll} onClick={() => setCallAllOpen(false)}>
              Cancelar
            </Button>
          </Sheet>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {active ? <PageHead title="Flash" subtitle="Estou livre agora. Para o futuro, use a Agenda." /> : null}
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
      {started ? (
        <div className="flashtoast" role="status">
          <span className="flashtoast__bolt">
            <BoltIcon filled />
          </span>
          <strong>Flash ativado</strong>
          <span>{started}</span>
        </div>
      ) : null}

      {active ? (
        <section className="flashpanel flashpanel--on" aria-label="Seu Flash">
          <div className="flashpanel__head">
            <span className="flashpanel__bolt">
              <BoltIcon filled />
            </span>
            <div>
              <p className="flashpanel__title">Flash ligado</p>
              <p className="flashpanel__sub">Faltam {formatRemaining(left)}</p>
            </div>
          </div>
          {status.data?.note ? <p className="flashpanel__note">“{status.data.note}”</p> : null}
          <p className="muted">Seus amigos com Flash ligado veem seu nome e sua foto. Ninguém vê onde você está até aceitar sair com você.</p>
          {confirmOff ? (
            <Confirm
              question="Desligar o Flash? Convites abertos e encontros em andamento serão encerrados."
              confirmLabel="Desligar"
              onConfirm={turnOff}
              onCancel={() => setConfirmOff(false)}
              busy={busy}
              danger
            />
          ) : (
            <Button variant="secondary" full onClick={() => setConfirmOff(true)}>
              Desligar Flash
            </Button>
          )}
        </section>
      ) : (
        <section className="flashoff" aria-label="Ligar o Flash">
          <header className="flashoff__head">
            <h1 className="flashoff__title">
              Flash <BoltIcon filled />
            </h1>
            <button type="button" className="flashoff__how" onClick={() => setInfoOpen(true)}>
              <HelpIcon />
              Como funciona?
            </button>
          </header>
          <p className="flashoff__sub">Livre agora? Encontre alguém para sair.</p>

          {/* Ilustração decorativa: os perfis são silhuetas e não indicam amigos disponíveis. */}
          <div className="flashhero" aria-hidden="true">
            {['5', '4', '3', '2', '1'].map((n) => (
              <span key={n} className={`flashhero__ring flashhero__ring--${n}`} />
            ))}
            <span className="flashhero__glow" />
            <svg className="flashhero__bolt" viewBox="0 0 100 100" focusable="false">
              <path d="M63 3 21 56h25l-8 41 42-55H55z" />
            </svg>
            {['a', 'b', 'c', 'd'].map((k) => (
              <span key={k} className={`flashhero__person flashhero__person--${k}`}>
                <img src={`/flash/${k}.jpg`} alt="" width="60" height="60" loading="lazy" decoding="async" />
              </span>
            ))}
            {['a', 'b', 'c', 'd', 'e'].map((k) => (
              <span key={k} className={`flashhero__dot flashhero__dot--${k}`} />
            ))}
          </div>

          <h2 className="flashoff__lead">
            Encontre amigos
            <br />
            que também estão <em>livres agora.</em>
          </h2>

          <ul className="flashperks">
            <li>
              <span className="flashperks__icon">
                <UsersIcon />
              </span>
              Apenas seus amigos
            </li>
            <li>
              <span className="flashperks__icon">
                <ClockIcon />
              </span>
              Tempo limitado
            </li>
            <li>
              <span className="flashperks__icon">
                <LockIcon />
              </span>
              Você controla a sua localização
            </li>
          </ul>

          <div className="flashdur" role="radiogroup" aria-label="Duração do Flash">
            {DURATIONS.map((d) => (
              <button key={d.minutes} type="button" role="radio" aria-checked={minutes === d.minutes} aria-label={d.label} className="flashdur__opt" onClick={() => setMinutes(d.minutes)}>
                <span className="flashdur__value">{d.value}</span>
                <span className="flashdur__unit">{d.unit}</span>
              </button>
            ))}
          </div>
          <Field
            label="Recado (opcional)"
            hideLabel
            placeholder="Adicionar recado"
            value={note}
            onChange={setNote}
            error={noteError}
            hint={note === '' ? undefined : `${Array.from(note).length}/${FLASH_NOTE_MAX}`}
            maxLength={FLASH_NOTE_MAX + 20}
            autoComplete="off"
          />
          <Button full loading={busy} onClick={turnOn}>
            <BoltIcon filled />
            Ativar Flash
          </Button>
          {explaining ? (
            <Sheet title="Antes de ligar o Flash" onClose={() => setExplaining(false)}>
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
                Entendi, ligar o Flash
              </Button>
            </Sheet>
          ) : null}
          <p className="flashoff__privacy">
            <LockIcon />
            <span>Sua localização só será compartilhada com amigos que você autorizar, enquanto o Flash estiver ativo.</span>
          </p>

          <Link to="/amigos/contatos" className="flashinvite">
            <span className="flashinvite__art" aria-hidden="true">
              <span className="flashinvite__p flashinvite__p--a" />
              <span className="flashinvite__p flashinvite__p--b" />
              <span className="flashinvite__plus">+</span>
            </span>
            <span className="flashinvite__body">
              <strong>Chame seus amigos para ativar o Flash também!</strong>
              <span>Quanto mais amigos ativos, maiores as chances de encontrar alguém para sair.</span>
            </span>
            <ChevronRightIcon />
          </Link>

          {infoOpen ? (
            <Sheet title="Como o Flash funciona" onClose={() => setInfoOpen(false)}>
              <p>Seus amigos que também estiverem com Flash ligado veem seu nome e sua foto.</p>
              <p>Sua localização só é compartilhada com quem aceitar sair com você.</p>
            </Sheet>
          ) : null}
        </section>
      )}

      {active ? mapSection : null}

      {receivedBlock}

      {matchesBlock}

      <section className="section" aria-labelledby="livres-titulo">
        <h2 id="livres-titulo" className="section__title">
          Livres agora
        </h2>
        {!active ? (
          <p className="muted">
            Ligue seu Flash para ver quais amigos estão livres agora. Para outro dia, use a <Link to="/agenda">Agenda</Link>.
          </p>
        ) : null}
        {active && available.loading && !available.data ? <Loading /> : null}
        {active && available.error && !available.data ? <ErrorState message={available.error.message} onRetry={available.reload} /> : null}
        {active && available.data && available.data.length === 0 ? (
          <EmptyState title="Nenhum amigo com Flash ligado agora">Quando alguém ligar o Flash, aparece aqui. Você também pode combinar um dia pela Agenda.</EmptyState>
        ) : null}
        {active && available.data && available.data.length > 0 ? (
          <ul className="list">
            {available.data.map((friend) => (
              <AvailableRow key={friend.profile.userId} friend={friend} onChanged={reloadAll} onFeedback={setFeedback} />
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

// ---------- Cartão do Flash ligado ----------

/** Relógio que anda de segundo em segundo sem refazer a tela toda. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const now = useNow(1000);
  return <span className="flashcard__time">{formatCountdown(Date.parse(expiresAt) - now)}</span>;
}

function FlashBar({ startsAt, expiresAt }: { startsAt: string | null; expiresAt: string }) {
  const now = useNow(1000);
  const share = flashRemainingShare(startsAt, expiresAt, now);
  return (
    <div className="flashbar" role="progressbar" aria-label="Tempo restante do Flash" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      <span className="flashbar__fill" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

// ---------- Linhas ----------

function BlockAction({ profile, onDone, onFeedback }: { profile: PublicProfile; onDone: () => void; onFeedback: (f: Feedback) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function block() {
    setBusy(true);
    try {
      await api.block(profile.userId);
      onFeedback({ tone: 'ok', text: `Você bloqueou ${profile.username}. Ele não vê mais você e vocês deixam de ser amigos.` });
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
        Bloquear
      </Button>
    );
  }
  return (
    <Confirm
      question={`Bloquear ${profile.username}? Vocês deixam de ser amigos e nenhum dos dois vê o outro.`}
      confirmLabel="Bloquear"
      onConfirm={block}
      onCancel={() => setAsking(false)}
      busy={busy}
      danger
    />
  );
}

function AvailableRow({ friend, onChanged, onFeedback }: { friend: AvailableFriend; onChanged: () => void; onFeedback: (f: Feedback) => void }) {
  const [busy, setBusy] = useState(false);
  const { profile, invite } = friend;
  const left = minutesLeft(friend.expiresAt, Date.now());

  async function send() {
    setBusy(true);
    try {
      await api.flashInvite(profile.userId);
      onFeedback({ tone: 'ok', text: `Convite enviado para ${profile.username}. Vale por 15 minutos.` });
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

  let action;
  if (invite?.direction === 'MATCHED') {
    action = (
      <Link to={`/flash/encontro/${invite.id}`} className="btn btn--primary btn--small">
        Ver encontro
      </Link>
    );
  } else if (invite?.direction === 'SENT') {
    action = (
      <Button small variant="secondary" loading={busy} onClick={cancel}>
        Cancelar convite
      </Button>
    );
  } else if (invite?.direction === 'RECEIVED') {
    action = <span className="muted">Convidou você</span>;
  } else {
    action = (
      <Button small loading={busy} onClick={send}>
        Convidar
      </Button>
    );
  }

  return (
    <li className="flashrow">
      <div className="person person--flat">
        <div className="person__link">
          <Avatar profile={profile} />
          <span className="person__body">
            <span className="person__name">{profile.username}</span>
            <span className="person__handle">{friend.note ? `“${friend.note}”` : `Livre por mais ${formatRemaining(left)}`}</span>
          </span>
        </div>
        <div className="person__aside">{action}</div>
      </div>
      <div className="flashrow__more">
        <BlockAction profile={profile} onDone={onChanged} onFeedback={onFeedback} />
      </div>
    </li>
  );
}

function InviteRow({ invite, canAccept, onChanged, onFeedback }: { invite: FlashInvite; canAccept: boolean; onChanged: () => void; onFeedback: (f: Feedback) => void }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | undefined>();

  async function answer(action: 'accept' | 'decline') {
    setBusy(action);
    try {
      const result = await api.flashRespond(invite.id, action);
      if (action === 'accept') {
        announceFlashChange();
        // Aceitou: abre o encontro, onde o envio da localização começa sozinho. A conversa fica a um toque dali.
        navigate(`/flash/encontro/${invite.id}`);
        return;
      }
      onChanged();
    } catch (failure) {
      onFeedback({ tone: 'error', text: toApiError(failure).message });
      onChanged();
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <li className="flashrow">
      <div className="person person--flat">
        <div className="person__link">
          <Avatar profile={invite.other} />
          <span className="person__body">
            <span className="person__name">{invite.other.username}</span>
            <span className="person__handle">Quer sair agora · {formatRemaining(minutesLeft(invite.expiresAt, Date.now()))} para responder</span>
          </span>
        </div>
      </div>
      {canAccept ? null : <p className="muted">Ligue seu Flash para aceitar.</p>}
      <div className="row-actions">
        <Button small loading={busy === 'accept'} disabled={!canAccept || busy === 'decline'} onClick={() => answer('accept')}>
          Aceitar
        </Button>
        <Button small variant="secondary" loading={busy === 'decline'} disabled={busy === 'accept'} onClick={() => answer('decline')}>
          Recusar
        </Button>
        <BlockAction profile={invite.other} onDone={onChanged} onFeedback={onFeedback} />
      </div>
    </li>
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

  function start() {
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
        setState({ phase: 'error', message: geolocationMessage(failure.code, true) });
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }

  // Com um encontro aceito, o envio começa sozinho (o navegador ainda pede a permissão do aparelho).
  useEffect(() => {
    if (auto && !stoppedByUser.current && state.phase === 'idle') start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, state.phase]);

  useEffect(
    () => () => {
      if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return { state, mine, start, stop };
}

function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

export function MatchScreen({ inviteId }: { inviteId: string }) {
  useTitle('Encontro');
  const match = useAsync(() => api.flashMatch(inviteId), [inviteId]);
  usePolling(match.reload, 8_000);

  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const share = useShareLocation([inviteId], match.reload, match.data !== undefined);
  const [mapFailed, setMapFailed] = useState(false);

  if (match.loading && !match.data && !match.error) return <Loading />;
  if (match.error && !match.data) {
    if (match.error.code === 'NOT_FOUND') {
      return (
        <>
          <PageHead title="Encontro" back="/flash" />
          <EmptyState
            title="Este encontro acabou"
            action={
              <Link to="/flash" className="btn btn--primary">
                Voltar ao Flash
              </Link>
            }
          >
            O convite venceu, alguém encerrou ou o Flash foi desligado. A localização compartilhada já foi apagada.
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
      navigate('/flash');
    } catch (failure) {
      setFeedback({ tone: 'error', text: toApiError(failure).message });
      setBusy(false);
    }
  }

  const left = minutesLeft(data.expiresAt, Date.parse(data.now));
  const them = data.them;
  const myPoint = share.mine ?? (data.me ? { lat: data.me.lat, lng: data.me.lng } : undefined);
  const distance = them && myPoint ? distanceMeters(myPoint, them) : undefined;

  return (
    <>
      <PageHead title={data.other.username} back="/flash" subtitle={`Encontro Flash · acaba em ${formatRemaining(left)}`} />
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

      <section className="whereis" aria-label={`Onde ${data.other.username} está`}>
        <Avatar profile={data.other} size={56} />
        {!them ? (
          <>
            <p className="whereis__main">Ainda sem localização</p>
            <p className="muted">{data.other.username} ainda não compartilhou. Assim que compartilhar, a distância aparece aqui.</p>
          </>
        ) : them.stale ? (
          <>
            <p className="whereis__main">Sem sinal</p>
            <p className="muted">
              A última localização de {data.other.username} foi {formatAge(them.updatedAt, data.now)}. Ela volta quando o sinal voltar.
            </p>
          </>
        ) : (
          <>
            <p className="whereis__main">{distance !== undefined ? `a ${formatDistance(distance)} de você` : 'Localização recebida'}</p>
            <p className="muted">Atualizado {formatAge(them.updatedAt, data.now)}.{distance === undefined ? ' Compartilhe a sua para ver a distância.' : ''}</p>
          </>
        )}
        {them ? (
          <a className="whereis__link" href={osmLink(them.lat, them.lng)} target="_blank" rel="noopener noreferrer">
            Abrir no mapa
          </a>
        ) : null}
      </section>

      {!mapFailed && (them || myPoint) ? (
        <Suspense fallback={<div className="matchmap matchmap--loading"><RingLoader size={72} label="Carregando o mapa" /></div>}>
          <MatchMap
            me={myPoint}
            others={
              them ? [{ id: inviteId, lat: them.lat, lng: them.lng, stale: them.stale, initials: initials(data.other.username) }] : []
            }
            onFail={() => setMapFailed(true)}
          />
        </Suspense>
      ) : null}

      <section className="sharebox" aria-label="Sua localização">
        {share.state.phase === 'sharing' ? (
          <>
            <p className="sharebox__title">Compartilhando sua localização</p>
            <p className="muted">
              {share.state.accuracyM !== undefined ? `Precisão de cerca de ${share.state.accuracyM} m. ` : ''}Mantenha esta tela aberta; ao sair, o envio para.
            </p>
            <Button variant="secondary" full onClick={share.stop}>
              Parar de compartilhar
            </Button>
          </>
        ) : (
          <>
            <p className="sharebox__title">Mostrar onde estou</p>
            <p className="muted">Só {data.other.username} vê sua localização, só durante este encontro, e ela some quando ele acabar. Ao aceitar o convite, o envio começa sozinho.</p>
            {share.state.phase === 'error' ? <Notice tone="error">{share.state.message}</Notice> : null}
            <Button full loading={share.state.phase === 'asking'} onClick={share.start}>
              Compartilhar minha localização
            </Button>
          </>
        )}
      </section>

      <div className="stack">
        <Link to={`/conversas/${data.conversationId}`} className="btn btn--primary btn--full">
          Conversar e sugerir um rolê
        </Link>
        {confirmEnd ? (
          <Confirm question="Encerrar o encontro? A localização dos dois deixa de ser compartilhada." confirmLabel="Encerrar" onConfirm={endMatch} onCancel={() => setConfirmEnd(false)} busy={busy} danger />
        ) : (
          <Button variant="secondary" full onClick={() => setConfirmEnd(true)}>
            Encerrar encontro
          </Button>
        )}
        <BlockAction profile={data.other} onDone={() => navigate('/flash')} onFeedback={setFeedback} />
      </div>
    </>
  );
}
