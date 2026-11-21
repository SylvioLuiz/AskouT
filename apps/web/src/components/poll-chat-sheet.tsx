import { useMemo, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { SearchIcon } from './icons.tsx';
import { Avatar, ErrorState, GroupAvatar, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { filterTargets, shareTargets } from '../lib/share-targets.ts';
import type { ShareTarget } from '../lib/share-targets.ts';
import { t } from '../lib/i18n/index.ts';
import './share-sheet.css';

/**
 * Onde a votação da data vai acontecer: um grupo ou a conversa com um amigo. Amigo sem conversa ainda abre uma na hora.
 * Quem estiver na conversa vota nos dias.
 */
export function PollChatSheet({ onPick, onClose }: { onPick: (conversationId: string) => void; onClose: () => void }) {
  const data = useAsync(() => Promise.all([api.conversations(), api.friends().catch(() => [])]), []);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const targets = useMemo(() => (data.data ? shareTargets(data.data[0].items, data.data[1]) : []), [data.data]);
  const visible = useMemo(() => filterTargets(targets, query), [targets, query]);

  async function pick(target: ShareTarget) {
    if (opening) return;
    setProblem(undefined);
    if (target.conversationId) return onPick(target.conversationId);
    if (!target.userId) return;
    setOpening(target.key);
    try {
      const { id } = await api.openConversation(target.userId);
      onPick(id);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setOpening(undefined);
    }
  }

  return (
    <Sheet title={t('Quem vota na data?')} onClose={onClose}>
      <div className="sharesheet">
        {targets.length > 0 ? (
          <label className="sharesheet__search">
            <SearchIcon />
            <span className="visually-hidden">{t('Buscar conversa ou amigo')}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar')} autoComplete="off" enterKeyHint="search" />
          </label>
        ) : null}
        {data.loading && !data.data ? <Loading /> : null}
        {data.error ? <ErrorState message={data.error.message} onRetry={data.reload} /> : null}
        {!data.loading && !data.error && targets.length === 0 ? (
          <div className="sharesheet__empty">
            <strong>{t('Ninguém para votar ainda')}</strong>
            <span>{t('A votação acontece numa conversa ou num grupo. Quando você e outra pessoa se seguirem, ela aparece aqui.')}</span>
          </div>
        ) : null}
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {visible.length > 0 ? (
          <ul className="sharesheet__grid" aria-label={t('Conversas e amigos')}>
            {visible.map((target) => (
              <li key={target.key}>
                <button type="button" className="sharesheet__person" onClick={() => void pick(target)} disabled={opening !== undefined}>
                  <span className="sharesheet__face">
                    {target.group ? <GroupAvatar name={target.group.name} size={56} imageUrl={target.group.imageUrl} /> : target.profile ? <Avatar profile={target.profile} size={56} /> : null}
                  </span>
                  <span className="sharesheet__name">{target.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="muted sharesheet__note">{t('Todos dessa conversa votam nos dias. A data mais votada vira a data do evento.')}</p>
      </div>
    </Sheet>
  );
}
