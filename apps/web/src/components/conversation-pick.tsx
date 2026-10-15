import { Avatar, GroupAvatar } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toggleId } from '../lib/meetup.ts';

/** Marcar conversas e grupos (várias) para enviar algo. */
export function ConversationPick({ selected, onChange, label }: { selected: string[]; onChange: (ids: string[]) => void; label: string }) {
  const chats = useAsync(() => api.conversations(), []);
  const sendable = (chats.data?.items ?? []).filter((c) => c.canSend);
  if (chats.data && sendable.length === 0) return <p className="muted">Você ainda não tem conversas para enviar.</p>;
  return (
    <ul className="sharelist" aria-label={label}>
      {sendable.map((c) => {
        const on = selected.includes(c.id);
        const name = c.type === 'GROUP' ? (c.name ?? 'Grupo') : (c.other?.username ?? 'Conversa');
        return (
          <li key={c.id}>
            <button type="button" className={`sharelist__item sharelist__item--person${on ? ' sharelist__item--on' : ''}`} aria-pressed={on} onClick={() => onChange(toggleId(selected, c.id))}>
              {c.type === 'GROUP' ? <GroupAvatar name={name} size={40} imageUrl={c.imageUrl} /> : c.other ? <Avatar profile={c.other} size={40} /> : null}
              <strong>{name}</strong>
              <span aria-hidden="true">{on ? '✓' : ''}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
