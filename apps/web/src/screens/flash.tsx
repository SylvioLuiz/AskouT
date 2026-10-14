import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BoltIcon, InfoIcon } from '../components/icons.tsx';
import { Sheet } from '../components/agenda.tsx';
import { Wheel } from '../components/wheel.tsx';
import { ChatButton } from '../components/chat-button.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import {
  announceFlashChange,
  distanceMeters,
  FLASH_DEFAULT_MINUTES,
  clampFlashMinutes,
  formatFlashDuration,
  FLASH_NOTE_MAX,
  flashNoteProblem,
  formatAge,
  formatDistance,
  formatRemaining,
  geolocationMessage,
  minutesLeft,
} from '../lib/flash.ts';
import { initials } from '../lib/avatar.ts';
import { toApiError } from '../lib/errors.ts';
import type { OtherPin } from '../components/match-map.tsx';
import type { AvailableFriend, FlashInvite, FlashMatch, PublicProfile } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';

const POLL_MS = 10_000;
const MINUTE_STEPS: readonly number[] = Array.from({ length: 12 }, (_, i) => i * 5);

// O mapa (MapLibre) é pesado: só é baixado quando alguém abre um encontro.
const MatchMap = lazy(() => import('../components/match-map.tsx'));

type Feedback = { tone: 'ok' | 'error'; text: string } | undefined;

// ---------- Tela do Flash ----------

export function FlashScreen() {
  useTitle('Flash');
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
  const share = useShareLocation(matchIds, () => {
    invites.reload();
    matchViews.reload();
  });
  const [mapFailed, setMapFailed] = useState(false);

  const [minutes, setMinutes] = useState(FLASH_DEFAULT_MINUTES);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();

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

  async function turnOn() {
    const problem = flashNoteProblem(note);
    setNoteError(problem);
    if (problem) return;
    setBusy(true);
    setFeedback(undefined);
    try {
      status.setData(await api.flashOn(minutes, note.trim()));
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

  return (
    <>
      <PageHead title="Flash" subtitle="Estou livre agora. Para o futuro, use a Agenda." />
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

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
        <section className="flashpanel" aria-label="Ligar o Flash">
          <p className="flashpanel__lead">Por quanto tempo você fica disponível?</p>
          <div className="wheels" role="group" aria-label="Duração do Flash">
            <Wheel label="Horas" values={[0, 1, 2, 3]} value={Math.floor(minutes / 60)} format={(v) => `${v} h`} onChange={(h) => setMinutes((cur) => clampFlashMinutes(h * 60 + (cur % 60)))} />
            <Wheel label="Minutos" values={MINUTE_STEPS} value={minutes % 60} format={(v) => `${String(v).padStart(2, '0')} min`} onChange={(m) => setMinutes((cur) => clampFlashMinutes(Math.floor(cur / 60) * 60 + m))} />
            <div className="wheels__band" aria-hidden="true" />
          </div>
          <p className="flashpanel__until" aria-live="polite">
            {formatFlashDuration(minutes)}, até {new Date(Date.now() + minutes * 60_000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
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
          <div className="flashpanel__go">
            <Button full loading={busy} onClick={turnOn}>
              Ligar Flash
            </Button>
            <button type="button" className="flashpanel__info" aria-label="Como o Flash funciona" onClick={() => setInfoOpen(true)}>
              <InfoIcon />
            </button>
          </div>
          {infoOpen ? (
            <Sheet title="Como o Flash funciona" onClose={() => setInfoOpen(false)}>
              <p>Seus amigos que também estiverem com Flash ligado veem seu nome e sua foto.</p>
              <p>Sua localização só é compartilhada com quem aceitar sair com você.</p>
            </Sheet>
          ) : null}
        </section>
      )}

      {active ? (
        <section className="section" aria-labelledby="mapa-titulo">
          <h2 id="mapa-titulo" className="section__title">
            No mapa
          </h2>
          {!mapFailed && (share.mine || mapOthers.length > 0) ? (
            <Suspense fallback={<div className="matchmap matchmap--loading" role="status">Carregando o mapa…</div>}>
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
        </section>
      ) : null}

      {received.length > 0 ? (
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
      ) : null}

      {matches.length > 0 ? (
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
      ) : null}

      <section className="section" aria-labelledby="livres-titulo">
        <h2 id="livres-titulo" className="section__title">
          Livres agora
        </h2>
        {!active ? <p className="muted">Ligue seu Flash para ver quais amigos estão livres agora.</p> : null}
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
        // Aceitou: abre a conversa com a pessoa. O mapa do encontro fica a um toque dali.
        navigate(result.conversationId ? `/conversas/${result.conversationId}` : `/flash/encontro/${invite.id}`);
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
function useShareLocation(inviteIds: readonly string[], onEnded: () => void) {
  const [state, setState] = useState<ShareState>({ phase: 'idle' });
  const [mine, setMine] = useState<{ lat: number; lng: number } | undefined>();
  const watchId = useRef<number | undefined>(undefined);
  const lastSent = useRef(0);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const idsRef = useRef(inviteIds);
  idsRef.current = inviteIds;

  function stop() {
    if (watchId.current !== undefined) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = undefined;
    setMine(undefined);
    setState({ phase: 'idle' });
  }

  function start() {
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
  const share = useShareLocation([inviteId], match.reload);
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
        <Suspense fallback={<div className="matchmap matchmap--loading" role="status">Carregando o mapa…</div>}>
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
            <p className="muted">Só {data.other.username} vê sua localização, só durante este encontro, e ela some quando ele acabar.</p>
            {share.state.phase === 'error' ? <Notice tone="error">{share.state.message}</Notice> : null}
            <Button full loading={share.state.phase === 'asking'} onClick={share.start}>
              Compartilhar minha localização
            </Button>
          </>
        )}
      </section>

      <div className="stack">
        <Link to={`/conversas/${data.conversationId}`} className="btn btn--primary btn--full">
          Conversar e sugerir um lugar
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
