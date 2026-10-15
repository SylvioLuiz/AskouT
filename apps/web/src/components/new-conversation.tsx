import { useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { toggleId } from '../lib/meetup.ts';
import { navigate } from '../router.tsx';
import { Sheet } from './agenda.tsx';
import { FriendPicker } from './meetup.tsx';
import { Button, Field } from './ui.tsx';

export const GROUP_NAME_MAX = 60;

/** Nova conversa: uma pessoa abre a conversa com ela; duas ou mais criam um grupo. */
export function NewConversationSheet({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const group = picked.length > 1;

  async function start() {
    setBusy(true);
    setProblem(undefined);
    try {
      const { id } = group ? await api.createGroup(name.trim(), picked) : await api.openConversation(picked[0]!);
      onClose();
      navigate(`/conversas/${id}`);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Nova conversa" onClose={onClose}>
      <p className="muted meetsheet__intro">Escolha um amigo para conversar. Com mais de um, cria um grupo.</p>
      <FriendPicker picked={picked} onToggle={(userId) => setPicked((cur) => toggleId(cur, userId))} />
      {group ? <Field label="Nome do grupo" value={name} onChange={setName} maxLength={GROUP_NAME_MAX} /> : null}
      {problem ? <p className="sugcard__problem">{problem}</p> : null}
      {picked.length > 0 ? (
        <Button full loading={busy} disabled={group && name.trim() === ''} onClick={start}>
          {group ? `Criar grupo com ${picked.length} pessoas` : 'Abrir conversa'}
        </Button>
      ) : null}
    </Sheet>
  );
}
