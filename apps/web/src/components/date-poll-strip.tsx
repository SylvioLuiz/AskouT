import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { shortDay } from '../lib/date-poll.ts';
import type { PollSummary } from '../lib/date-poll.ts';
import { Link } from '../router.tsx';

function statusText(p: PollSummary): string {
  if (p.status === 'FINALIZED') return p.finalDate ? `Data definida: ${shortDay(p.finalDate)}` : 'Data definida';
  if (p.needsMyConfirmation) return 'Confirme a data proposta';
  if (p.status === 'CONFIRMING') return 'Data em confirmação';
  return p.needsMyVote ? 'Falta você votar' : 'Você já votou';
}

/** Votações de data desta conversa, logo abaixo do topo. */
export function PollStrip({ conversationId }: { conversationId: string }) {
  const list = useAsync(() => api.conversationPolls(conversationId), [conversationId]);
  const items = list.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <ul className="pollstrip" aria-label="Votações de data">
      {items.map((p) => (
        <li key={p.id}>
          <Link to={`/planejar/${p.id}`} className={`pollstrip__item${p.needsMyVote || p.needsMyConfirmation ? ' is-todo' : ''}`}>
            <strong>{p.title}</strong>
            <span>{statusText(p)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
