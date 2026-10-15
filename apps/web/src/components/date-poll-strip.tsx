import { api } from '../client.ts';
import { useAsync, usePolling } from '../hooks.ts';
import { pollLine } from '../lib/date-poll.ts';
import { Link } from '../router.tsx';

const MAX_LINES = 2;

/** Linha fixa logo abaixo do título da conversa: andamento das votações de data e a data já marcada. */
export function PollLine({ conversationId }: { conversationId: string }) {
  const list = useAsync(() => api.conversationPolls(conversationId), [conversationId]);
  usePolling(list.reload, 30_000);
  const now = new Date();
  const lines = (list.data?.items ?? []).flatMap((p) => {
    const text = pollLine(p, now);
    return text ? [{ id: p.id, text, todo: p.needsMyVote || p.needsMyConfirmation }] : [];
  });
  if (lines.length === 0) return null;
  const shown = lines.slice(0, MAX_LINES);
  return (
    <div className="pollline">
      {shown.map((l) => (
        <Link key={l.id} to={`/planejar/${l.id}`} className={`pollline__item${l.todo ? ' is-todo' : ''}`}>
          {l.text}
        </Link>
      ))}
      {lines.length > MAX_LINES ? <span className="pollline__more">+{lines.length - MAX_LINES} votações</span> : null}
    </div>
  );
}
