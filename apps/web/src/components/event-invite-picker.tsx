import { useMemo, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { FriendPicker } from './meetup.tsx';
import { Avatar, Button, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { toggleId } from '../lib/meetup.ts';
import { t } from '../lib/i18n/index.ts';

/**
 * Folha "Convidar pessoas" de um evento já criado: o mesmo seletor de amigos da criação, sem quem tem convite pendente ou
 * já aceitou (quem recusou volta a aparecer e pode ser convidado de novo). Os convites pendentes ficam listados para cancelar.
 * Com `onInvite`, convida na hora (lista de quem vai); sem ele, só devolve a escolha em `onDone` (a edição manda ao salvar).
 */
export function EventInviteSheet({ eventId, picked: initial = [], onDone, onInvite, onClose }: { eventId: string; picked?: readonly string[]; onDone?: (userIds: string[]) => void; onInvite?: (invited: number) => void; onClose: () => void }) {
  const invites = useAsync(() => api.eventInvites(eventId).then((r) => r.invites), [eventId]);
  const exclude = useMemo(() => (invites.data ?? []).filter((i) => i.status !== 'DECLINED').map((i) => i.user.userId), [invites.data]);
  const pending = (invites.data ?? []).filter((i) => i.status === 'PENDING');
  const [picked, setPicked] = useState<string[]>([...initial]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const chosen = picked.filter((id) => !exclude.includes(id));

  async function done() {
    if (!onInvite) {
      onDone?.(chosen);
      return;
    }
    if (chosen.length === 0) {
      onClose();
      return;
    }
    setMessage(undefined);
    setBusy(true);
    try {
      const result = await api.inviteToEvent(eventId, chosen);
      onInvite(result.invited.length);
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  async function cancel(userId: string) {
    setMessage(undefined);
    setCancelling(userId);
    try {
      await api.cancelEventInvite(eventId, userId);
      setPicked((c) => c.filter((id) => id !== userId));
      invites.reload();
    } catch (failure) {
      setMessage(toApiError(failure).message);
    } finally {
      setCancelling(undefined);
    }
  }

  return (
    <Sheet title={t('Convidar pessoas')} onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <p className="muted">{t('Só amigos. Quem já tem convite não aparece aqui até recusar. Cada pessoa recebe o convite e aceita para o evento ir para o perfil dela.')}</p>
      {pending.length > 0 ? (
        <section className="evinvites" aria-labelledby="evinvites-title">
          <h3 id="evinvites-title" className="results__h">
            {t('Convites pendentes')} <span className="evwho__count">{pending.length}</span>
          </h3>
          <ul className="evwho__list">
            {pending.map((i) => (
              <li key={i.user.userId} className="evwho__item">
                <Avatar profile={i.user} size={40} />
                <span className="evwho__who">
                  <strong>{i.user.displayName}</strong>
                  <span>@{i.user.username}</span>
                </span>
                <Button small variant="quiet" loading={cancelling === i.user.userId} disabled={cancelling !== undefined} onClick={() => void cancel(i.user.userId)} aria-label={t('Cancelar o convite de {name}', { name: i.user.displayName })}>
                  {t('Cancelar')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* Esperar a lista de convidados para não oferecer quem já foi convidado. */}
      {invites.data === undefined && invites.loading ? null : <FriendPicker picked={picked} exclude={exclude} onToggle={(id) => setPicked((c) => toggleId(c, id))} />}
      <Button full loading={busy} onClick={() => void done()}>
        {onInvite ? (chosen.length === 0 ? t('Concluir') : chosen.length === 1 ? t('Convidar 1 pessoa') : t('Convidar {n} pessoas', { n: chosen.length })) : t('Concluir')}
      </Button>
    </Sheet>
  );
}
