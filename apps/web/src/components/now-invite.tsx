import { useEffect, useRef, useState } from 'react';
import { api } from '../client.ts';
import { announceFlashChange, formatApprox, formatClock, minutesLeft } from '../lib/flash.ts';
import { initials, tintIndex } from '../lib/avatar.ts';
import { toApiError } from '../lib/errors.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';
import type { AvailableFriend, FlashInvite, FlashInviteConflict, PublicProfile } from '../lib/types.ts';
import { navigate } from '../router.tsx';
import { Sheet } from './agenda.tsx';
import { BoltIcon, ChevronDownIcon, ClockIcon, LocationIcon } from './icons.tsx';

// Convite do NOW recebido: o cartão em foco na tela do NOW, o aviso que desce no topo de qualquer tela e a folha que
// ele abre usam as mesmas peças daqui.

/** Foto redonda (ou iniciais) sem o raio do NOW: aqui o contexto já diz que a pessoa está livre. */
export function NowFace({ profile, size, className = '' }: { profile: PublicProfile; size: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return profile.avatarUrl ? (
    <img className={`nowface ${className}`} src={profile.avatarUrl.startsWith('/') ? api.assetUrl(profile.avatarUrl) : profile.avatarUrl} alt="" style={style} referrerPolicy="no-referrer" />
  ) : (
    <span className={`nowface avatar--tint-${tintIndex(profile.username)} ${className}`} style={style} aria-hidden="true">
      {initials(profile.username)}
    </span>
  );
}

/** Relógio que anda sozinho. */
export function useTick(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Quanto do convite ainda resta (1 = acabou de chegar). */
function inviteShare(invite: FlashInvite, now: number): number {
  const start = Date.parse(invite.createdAt);
  const end = Date.parse(invite.expiresAt);
  if (!(end > start)) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** Foto de quem convidou com o tempo para responder num anel de cor só em volta, e o recado num balão em cima. */
function TimerFace({ invite, note, size }: { invite: FlashInvite; note: string | null | undefined; size: number }) {
  const now = useTick(1000);
  const share = inviteShare(invite, now);
  return (
    <span className="nowinv__face">
      {note ? <span className="nownote nownote--small">{note}</span> : null}
      <span className="nowinv__ring" style={{ background: `conic-gradient(var(--now-pink) 0 ${share * 100}%, var(--now-track) ${share * 100}% 100%)` }}>
        <NowFace profile={invite.other} size={size} />
      </span>
    </span>
  );
}

/** Modal do relógio: o tempo que falta para responder. */
function TimeModal({ invite, onClose }: { invite: FlashInvite; onClose: () => void }) {
  const now = useTick(1000);
  const share = inviteShare(invite, now);
  return (
    <div className="nowmodal" role="dialog" aria-modal="true" aria-labelledby="nowmodal-t" onClick={onClose}>
      <div className="nowmodal__box" onClick={(e) => e.stopPropagation()}>
        <span className="nowmodal__ring" style={{ background: `conic-gradient(var(--now-pink) 0 ${share * 100}%, var(--now-track) ${share * 100}% 100%)` }}>
          <span>{formatClock(Date.parse(invite.expiresAt) - now)}</span>
        </span>
        <strong id="nowmodal-t">{t('Tempo para responder')}</strong>
        <p>{t('O convite de {name} vale até {time}. Depois disso ele expira e a pessoa pode chamar de novo.', { name: invite.other.username, time: hhmm(invite.expiresAt) })}</p>
        <button type="button" className="nowmodal__ok" onClick={onClose} autoFocus>
          {t('Entendi')}
        </button>
      </div>
    </div>
  );
}

/** Chip de localização no canto: escolhe se quem convidou vai ver sua posição exata ou só a região (~3 km). */
function PrecisionChip({ approx, onChange, disabled }: { approx: boolean; onChange: (approx: boolean) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="nowchip-wrap">
      <button type="button" className="nowchip" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)} aria-label={approx ? t('Localização aproximada. Trocar') : t('Localização exata. Trocar')}>
        <LocationIcon />
        {approx ? t('aproximada') : t('exata')}
        <ChevronDownIcon />
      </button>
      {open ? (
        <span className="nowchip__menu" role="menu">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              role="menuitemradio"
              aria-checked={approx === value}
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
            >
              <strong>{value ? t('Aproximada') : t('Exata')}</strong>
              <span>{value ? t('Só a região, uns 3 km') : t('Vê onde você está')}</span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/** Aceitar (abre o encontro) ou recusar um convite recebido. */
function useAnswer(invite: FlashInvite, onDone: () => void) {
  const [busy, setBusy] = useState<'accept' | 'decline' | undefined>();
  const [error, setError] = useState<string | undefined>();
  async function answer(action: 'accept' | 'decline', approx: boolean) {
    setBusy(action);
    setError(undefined);
    try {
      await api.flashRespond(invite.id, action, approx);
      announceFlashChange();
      if (action === 'accept') navigate(`/now/encontro/${invite.id}`);
      onDone();
    } catch (failure) {
      setError(toApiError(failure).message);
      announceFlashChange();
    } finally {
      setBusy(undefined);
    }
  }
  return { busy, error, answer };
}

interface InviteProps {
  invite: FlashInvite;
  /** A mesma pessoa na lista de livres: traz o recado e a distância aproximada. */
  friend?: AvailableFriend | undefined;
  onDone: () => void;
}

/** "hoje, 19:30–22:30", "amanhã, 20:00–23:00" ou "sáb., 12/12, 20:00–02:00": dia e horário do compromisso. */
export function conflictWhen(c: Pick<FlashInviteConflict, 'startsAt' | 'endsAt'>, now: Date = new Date()): string {
  const start = new Date(c.startsAt);
  const end = new Date(c.endsAt);
  const clock = (d: Date) => d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(start) - midnight(now)) / 86_400_000);
  const day = days <= 0 ? t('hoje') : days === 1 ? t('amanhã') : start.toLocaleDateString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${day}, ${clock(start)}–${clock(end)}`;
}

function conflictText(c: FlashInviteConflict): string {
  const when = conflictWhen(c);
  if (c.kind === 'NOW') return c.withName ? t('Você já combinou sair com {name} pelo NOW ({when}).', { name: c.withName, when }) : t('Você já tem um encontro do NOW ({when}).', { when });
  const title = c.title ?? t('um encontro');
  return c.withName ? t('Você confirmou "{title}" com {name} ({when}).', { title, name: c.withName, when }) : t('Você organiza "{title}" ({when}).', { title, when });
}

/** Aviso antes de responder: o convite bate com algo que você já aceitou de outra pessoa. */
function InviteConflicts({ invite }: { invite: FlashInvite }) {
  const list = invite.conflicts ?? [];
  if (list.length === 0) return null;
  return (
    <div className="nowinv__conflict" role="note">
      <strong>{t('Choque de horário')}</strong>
      <ul>
        {list.map((c) => (
          <li key={`${c.kind}:${c.startsAt}:${c.title ?? ''}:${c.withName ?? ''}`}>{conflictText(c)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Cartão do convite em foco na tela do NOW. O resto da tela fica esmaecido até responder ou tocar fora. */
export function InviteFocusCard({ invite, friend, onDone }: InviteProps) {
  const [approx, setApprox] = useState(false);
  const [clock, setClock] = useState(false);
  const { busy, error, answer } = useAnswer(invite, onDone);
  const distance = friend?.approx ? t('{distance} de você', { distance: formatApprox(friend.approx, true) }) : t('Livre agora');
  return (
    <section className="nowinv" aria-labelledby={`nowinv-${invite.id}`}>
      <div className="nowinv__tools">
        <button type="button" className="nowinv__clock" onClick={() => setClock(true)} aria-label={t('Ver tempo para responder')}>
          <ClockIcon />
        </button>
        <PrecisionChip approx={approx} onChange={setApprox} disabled={busy !== undefined} />
      </div>
      <div className="nowinv__row">
        <TimerFace invite={invite} note={friend?.note} size={56} />
        <div className="nowinv__text">
          <h2 id={`nowinv-${invite.id}`}>{t('{name} te chamou para sair', { name: invite.other.username })}</h2>
          <span>{distance}</span>
        </div>
      </div>
      <InviteConflicts invite={invite} />
      {error ? <p className="nowinv__error" role="alert">{error}</p> : null}
      <div className="nowinv__act">
        <button type="button" className="nowbtn nowbtn--no" disabled={busy !== undefined} aria-busy={busy === 'decline' || undefined} onClick={() => void answer('decline', false)}>
          {t('Agora não')}
        </button>
        <button type="button" className="nowbtn nowbtn--yes" disabled={busy !== undefined} aria-busy={busy === 'accept' || undefined} onClick={() => void answer('accept', approx)}>
          {t('Bora!')}
        </button>
      </div>
      {clock ? <TimeModal invite={invite} onClose={() => setClock(false)} /> : null}
    </section>
  );
}

/** Folha aberta ao tocar no aviso: foto grande, recado, distância e os mesmos botões do cartão. */
function InviteSheetBody({ invite, friend, onDone }: InviteProps) {
  const [approx, setApprox] = useState(false);
  const now = useTick(15_000);
  const { busy, error, answer } = useAnswer(invite, onDone);
  const left = minutesLeft(invite.expiresAt, now);
  return (
    <div className="nowsheet">
      <div className="nowsheet__tools">
        <PrecisionChip approx={approx} onChange={setApprox} disabled={busy !== undefined} />
      </div>
      <TimerFace invite={invite} note={friend?.note} size={76} />
      <h2 className="nowsheet__title">{t('{name} quer sair com você', { name: invite.other.username })}</h2>
      <p className="nowsheet__sub">
        {friend?.approx ? `${formatApprox(friend.approx, true)} · ` : ''}
        {t('responda em {left} min', { left })}
      </p>
      <InviteConflicts invite={invite} />
      {error ? <p className="nowinv__error" role="alert">{error}</p> : null}
      <div className="nowinv__act">
        <button type="button" className="nowbtn nowbtn--no" disabled={busy !== undefined} onClick={() => void answer('decline', false)}>
          {t('Agora não')}
        </button>
        <button type="button" className="nowbtn nowbtn--yes" disabled={busy !== undefined} onClick={() => void answer('accept', approx)}>
          {t('Bora!')}
        </button>
      </div>
    </div>
  );
}

const TOAST_MS = 5000;

/**
 * Convite novo chegando fora da tela do NOW: desce do topo como um aviso no meio, some em 5 s ou ao empurrar para
 * cima. Tocar abre a folha para responder ali mesmo. Se a pessoa perder o aviso, o convite espera na tela do NOW.
 */
export function NowInviteToast({ received, enabled }: { received: readonly FlashInvite[]; enabled: boolean }) {
  const seen = useRef<Set<string> | undefined>(undefined);
  const [shown, setShown] = useState<FlashInvite | undefined>();
  const [open, setOpen] = useState<FlashInvite | undefined>();
  const [leaving, setLeaving] = useState(false);
  const friends = useRef(new Map<string, AvailableFriend>());
  const drag = useRef<{ y: number; id: number } | undefined>(undefined);
  const box = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Na primeira leitura, o que já estava lá não vira aviso: só o que chegar depois.
    if (seen.current === undefined) {
      seen.current = new Set(received.map((i) => i.id));
      return;
    }
    const fresh = received.find((i) => !seen.current!.has(i.id));
    for (const i of received) seen.current.add(i.id);
    if (!fresh || !enabled) return;
    setLeaving(false);
    setShown(fresh);
    // Recado e distância vêm da lista de livres (quem convida está com o NOW ligado, como você).
    api
      .flashAvailable()
      .then((r) => {
        for (const f of r.items) friends.current.set(f.profile.userId, f);
        setShown((s) => (s ? { ...s } : s));
      })
      .catch(() => undefined);
  }, [received, enabled]);

  useEffect(() => {
    if (!shown) return undefined;
    const timer = window.setTimeout(() => hide(), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  function hide() {
    setLeaving(true);
    window.setTimeout(() => {
      setShown(undefined);
      setLeaving(false);
    }, 220);
  }

  // Convite que expirou ou foi respondido em outro lugar fecha a folha.
  const openStill = open ? received.find((i) => i.id === open.id) : undefined;

  const friend = shown ? friends.current.get(shown.other.userId) : undefined;
  return (
    <>
      {shown ? (
        <button
          ref={box}
          type="button"
          className={`nowtoast${leaving ? ' nowtoast--out' : ''}`}
          onClick={() => {
            setOpen(shown);
            setShown(undefined);
          }}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, id: e.pointerId };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !box.current) return;
            const dy = Math.min(0, e.clientY - d.y);
            box.current.style.transform = `translate(-50%, ${dy}px)`;
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = undefined;
            if (!d || !box.current) return;
            const dy = e.clientY - d.y;
            box.current.style.transform = '';
            if (dy < -30) {
              e.preventDefault();
              hide();
            }
          }}
          aria-live="polite"
        >
          <NowFace profile={shown.other} size={38} />
          <span className="nowtoast__text">
            <strong>{t('{name} te chamou para sair agora', { name: shown.other.username })}</strong>
            <span>{[friend?.note, friend?.approx ? formatApprox(friend.approx, true) : undefined].filter(Boolean).join(' · ') || t('Toque para responder')}</span>
          </span>
          <span className="nowtoast__bolt" aria-hidden="true">
            <BoltIcon filled />
          </span>
          <span className="nowtoast__line" aria-hidden="true" />
        </button>
      ) : null}
      {openStill ? (
        <Sheet title={t('Convite do NOW')} hideTitle onClose={() => setOpen(undefined)}>
          <InviteSheetBody invite={openStill} friend={friends.current.get(openStill.other.userId)} onDone={() => setOpen(undefined)} />
        </Sheet>
      ) : null}
    </>
  );
}
