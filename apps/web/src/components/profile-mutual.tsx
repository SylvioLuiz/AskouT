import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';
import { Sheet } from './agenda.tsx';
import { Avatar } from './ui.tsx';

const FACES = 3;
const NAMES = 2;

/** "Amigos em comum" no perfil de outra pessoa: rostos empilhados e os primeiros nomes; tocar abre a lista. Sem nenhum em comum, não aparece. */
export function MutualFriends({ userId }: { userId: string }) {
  const data = useAsync(() => api.mutualFriends(userId), [userId]);
  const [open, setOpen] = useState(false);
  const items = data.data?.items ?? [];
  if (items.length === 0) return null;

  const total = data.data?.total ?? items.length;
  const names = items.slice(0, NAMES).map((p) => p.username);
  const rest = total - names.length;
  const text =
    names.length === 1
      ? t('Amigos em comum: {a}', { a: names[0]! })
      : rest > 0
        ? t('Amigos em comum: {a}, {b} e mais {n}', { a: names[0]!, b: names[1]!, n: rest })
        : t('Amigos em comum: {a} e {b}', { a: names[0]!, b: names[1]! });

  return (
    <>
      <button type="button" className="profile__mutual" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="profile__mutualfaces" aria-hidden="true">
          {items.slice(0, FACES).map((p) => (
            <Avatar key={p.userId} profile={p} size={24} />
          ))}
        </span>
        <span className="profile__mutualtext">{text}</span>
      </button>
      {open ? (
        <Sheet title={t('Amigos em comum ({n})', { n: total })} onClose={() => setOpen(false)}>
          <ul className="evwho__list">
            {items.map((p) => (
              <li key={p.userId} className="evwho__item">
                <Avatar profile={p} size={44} />
                <Link to={`/u/${encodeURIComponent(p.username)}`} className="evwho__who" onClick={() => setOpen(false)}>
                  <strong>{p.displayName}</strong>
                  <span>@{p.username}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}
