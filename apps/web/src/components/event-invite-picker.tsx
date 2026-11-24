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
 * Com `groupId` (o grupo do evento): pergunta se quem foi convidado entra no grupo e se quem teve o convite cancelado sai
 * dele. Entrar ou sair do grupo também põe ou tira a pessoa da votação da data aberta nele.
 */
export function EventInviteSheet({ eventId, groupId, picked: initial = [], onDone, onInvite, onClose }: { eventId: string; groupId?: string; picked?: readonly string[]; onDone?: (userIds: string[]) => void; onInvite?: (invited: number) => void; onClose: () => void }) {
  const invites = useAsync(() => api.eventInvites(eventId).then((r) => r.invites), [eventId]);
  const exclude = useMemo(() => (invites.data ?? []).filter((i) => i.status !== 'DECLINED').map((i) => i.user.userId), [invites.data]);
  const pending = (invites.data ?? []).filter((i) => i.status === 'PENDING');
  const [picked, setPicked] = useState<string[]>([...initial]);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const chosen = picked.filter((id) => !exclude.includes(id));
  const group = useAsync(() => (groupId ? api.group(groupId).then((g) => g.members.map((m) => m.profile.userId)) : Promise.resolve([] as string[])), [groupId]);
  const inGroup = group.data ?? [];
  // Quem for convidado entra também no grupo do evento (e na votação dele): ligado por padrão, dá para desligar.
  const [alsoGroup, setAlsoGroup] = useState(true);
  // Convite cancelado de alguém que está no grupo: pergunta se tira do grupo também.
  const [askRemove, setAskRemove] = useState<string | undefined>();
  const toGroup = groupId && alsoGroup ? chosen.filter((id) => !inGroup.includes(id)) : [];

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
      if (groupId && toGroup.length > 0) {
        try {
          await api.addGroupMembers(groupId, toGroup);
        } catch (failure) {
          // O convite já saiu; só o grupo falhou (por exemplo, grupo cheio).
          setMessage(t('Convite enviado, mas não deu para colocar no grupo: {reason}', { reason: toApiError(failure).message }));
          setBusy(false);
          invites.reload();
          setPicked([]);
          return;
        }
      }
      onInvite(result.invited.length);
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  async function cancel(userId: string, leaveGroup = false) {
    setMessage(undefined);
    setAskRemove(undefined);
    setCancelling(userId);
    try {
      await api.cancelEventInvite(eventId, userId);
      if (leaveGroup && groupId) {
        await api.removeMember(groupId, userId);
        group.reload();
      }
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
                {askRemove === i.user.userId ? null : (
                  <Button
                    small
                    variant="quiet"
                    loading={cancelling === i.user.userId}
                    disabled={cancelling !== undefined}
                    onClick={() => (inGroup.includes(i.user.userId) ? setAskRemove(i.user.userId) : void cancel(i.user.userId))}
                    aria-label={t('Cancelar o convite de {name}', { name: i.user.displayName })}
                  >
                    {t('Cancelar')}
                  </Button>
                )}
                {askRemove === i.user.userId ? (
                  <div className="evinvites__ask" role="group" aria-label={t('Tirar {name} do grupo do evento também?', { name: i.user.displayName })}>
                    <p>{t('Tirar {name} do grupo do evento também? Sai da votação da data junto.', { name: i.user.displayName })}</p>
                    <div className="evinvites__askbtns">
                      <Button small variant="danger" onClick={() => void cancel(i.user.userId, true)}>
                        {t('Tirar do grupo')}
                      </Button>
                      <Button small variant="secondary" onClick={() => void cancel(i.user.userId)}>
                        {t('Só o convite')}
                      </Button>
                      <Button small variant="quiet" onClick={() => setAskRemove(undefined)}>
                        {t('Voltar')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* Esperar a lista de convidados para não oferecer quem já foi convidado. */}
      {invites.data === undefined && invites.loading ? null : <FriendPicker picked={picked} exclude={exclude} onToggle={(id) => setPicked((c) => toggleId(c, id))} />}
      {groupId && onInvite && chosen.some((id) => !inGroup.includes(id)) ? (
        <label className="evinvites__group">
          <input type="checkbox" checked={alsoGroup} onChange={(ev) => setAlsoGroup(ev.target.checked)} />
          <span>{t('Colocar também no grupo do evento (entra na votação da data, se tiver)')}</span>
        </label>
      ) : null}
      <Button full loading={busy} onClick={() => void done()}>
        {onInvite ? (chosen.length === 0 ? t('Concluir') : chosen.length === 1 ? t('Convidar 1 pessoa') : t('Convidar {n} pessoas', { n: chosen.length })) : t('Concluir')}
      </Button>
    </Sheet>
  );
}
