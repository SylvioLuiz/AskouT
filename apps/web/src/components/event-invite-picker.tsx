import { useMemo, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { FriendPicker } from './meetup.tsx';
import { Button, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { toggleId } from '../lib/meetup.ts';
import { t } from '../lib/i18n/index.ts';

/**
 * Folha "Convidar pessoas" de um evento já criado: o mesmo seletor de amigos da criação, sem quem já foi convidado.
 * Com `onInvite`, convida na hora (lista de quem vai); sem ele, só devolve a escolha em `onDone` (a edição manda ao salvar).
 */
export function EventInviteSheet({ eventId, picked: initial = [], onDone, onInvite, onClose }: { eventId: string; picked?: readonly string[]; onDone?: (userIds: string[]) => void; onInvite?: (invited: number) => void; onClose: () => void }) {
  const invites = useAsync(() => api.eventInvites(eventId).then((r) => r.invites.map((i) => i.user.userId)), [eventId]);
  const exclude = useMemo(() => invites.data ?? [], [invites.data]);
  const [picked, setPicked] = useState<string[]>([...initial]);
  const [busy, setBusy] = useState(false);
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

  return (
    <Sheet title={t('Convidar pessoas')} onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <p className="muted">{t('Só amigos. Quem já foi convidado não aparece aqui. Cada pessoa recebe o convite e aceita para o evento ir para o perfil dela.')}</p>
      {/* Esperar a lista de convidados para não oferecer quem já foi convidado. */}
      {invites.loading ? null : <FriendPicker picked={picked} exclude={exclude} onToggle={(id) => setPicked((c) => toggleId(c, id))} />}
      <Button full loading={busy} onClick={() => void done()}>
        {onInvite ? (chosen.length === 0 ? t('Concluir') : chosen.length === 1 ? t('Convidar 1 pessoa') : t('Convidar {n} pessoas', { n: chosen.length })) : t('Concluir')}
      </Button>
    </Sheet>
  );
}
