import { useRef, useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { toggleId } from '../lib/meetup.ts';
import { navigate } from '../router.tsx';
import { Sheet } from './agenda.tsx';
import { FriendPicker } from './meetup.tsx';
import { Button, Field } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

export const GROUP_NAME_MAX = 60;

/**
 * Nova conversa: uma pessoa abre a conversa com ela; duas ou mais criam um grupo de amigos.
 * No grupo ninguém entra direto: cada pessoa escolhida recebe um convite e entra quando aceitar.
 * `group` (botão "Criar grupo"): já abre como grupo, e dá para criar com uma pessoa só.
 */
export function NewConversationSheet({ onClose, group: groupOnly = false }: { onClose: () => void; group?: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const footRef = useRef<HTMLDivElement>(null);
  const group = groupOnly || picked.length > 1;

  async function start() {
    setBusy(true);
    setProblem(undefined);
    try {
      const { id } = group ? await api.createCommunity(name.trim(), picked) : await api.openConversation(picked[0]!);
      onClose();
      navigate(group ? `/conversas/${id}/grupo` : `/conversas/${id}`);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  // Com o teclado aberto no nome, o botão de criar continua à vista.
  const keepFootVisible = () => window.setTimeout(() => footRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 250);

  return (
    <Sheet title={groupOnly ? t('Novo grupo') : t('Nova conversa')} onClose={onClose}>
      <p className="muted meetsheet__intro">
        {groupOnly
          ? t('Escolha os amigos para convidar. Cada um recebe um convite e entra no grupo quando aceitar.')
          : t('Escolha um amigo para conversar. Com mais de um, cria um grupo: cada pessoa recebe um convite e entra quando aceitar.')}
      </p>
      <FriendPicker picked={picked} onToggle={(userId) => setPicked((cur) => toggleId(cur, userId))} />
      {picked.length > 0 || groupOnly ? (
        <div className="newgroup__foot" ref={footRef}>
          {group ? (
            <div onFocus={keepFootVisible}>
              <Field label={t('Nome do grupo')} value={name} onChange={setName} maxLength={GROUP_NAME_MAX} />
            </div>
          ) : null}
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full loading={busy} disabled={picked.length === 0 || (group && name.trim() === '')} onClick={start}>
            {group
              ? picked.length === 0
                ? t('Escolha quem convidar')
                : picked.length === 1
                  ? t('Criar grupo e convidar 1 pessoa')
                  : t('Criar grupo e convidar {length} pessoas', { length: picked.length })
              : t('Abrir conversa')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
