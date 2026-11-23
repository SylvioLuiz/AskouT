import { api } from '../client.ts';
import { useAsync, usePolling } from '../hooks.ts';
import { pinnedPoll, pollLine } from '../lib/date-poll.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';
import { CalendarIcon } from './icons.tsx';
import './date-poll-strip.css';

const MAX_LINES = 2;
const MAX_PINNED = 2;

const ACTION_LABEL = { vote: 'Votar', confirm: 'Confirmar', view: 'Ver' } as const;

/**
 * Topo da conversa, logo abaixo do título: a votação de data ainda aberta fica FIXADA como um cartão (no grupo de um
 * evento sem data é a votação que decide o dia), com o que a pessoa tem a fazer. Datas já marcadas viram uma linha.
 */
export function PollLine({ conversationId }: { conversationId: string }) {
  const list = useAsync(() => api.conversationPolls(conversationId), [conversationId]);
  usePolling(list.reload, 30_000);
  const now = new Date();
  const items = list.data?.items ?? [];
  const pinned = items.flatMap((p) => {
    const pin = pinnedPoll(p, now);
    return pin ? [{ id: p.id, ...pin }] : [];
  });
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const lines = items.flatMap((p) => {
    if (pinnedIds.has(p.id)) return [];
    const text = pollLine(p, now);
    return text ? [{ id: p.id, name: text.name, status: text.status, todo: p.needsMyVote || p.needsMyConfirmation }] : [];
  });
  if (pinned.length === 0 && lines.length === 0) return null;
  const shownPins = pinned.slice(0, MAX_PINNED);
  const shown = lines.slice(0, MAX_LINES);
  return (
    <div className="pollline">
      {shownPins.map((p) => (
        <Link key={p.id} to={`/planejar/${p.id}`} className={`pollpin${p.action !== 'view' ? ' is-todo' : ''}`} aria-label={t('Votação fixada: {name}, {status}', { name: p.name, status: p.status })}>
          <span className="pollpin__icon" aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className="pollpin__text">
            <span className="pollpin__name">{p.name}</span>
            <span className="pollpin__status">{p.status}</span>
          </span>
          <span className="pollpin__action">{t(ACTION_LABEL[p.action])}</span>
        </Link>
      ))}
      {pinned.length > MAX_PINNED ? <span className="pollline__more">{t('+{count} votações', { count: pinned.length - MAX_PINNED })}</span> : null}
      {shown.map((l) => (
        <Link key={l.id} to={`/planejar/${l.id}`} className={`pollline__item${l.todo ? ' is-todo' : ''}`}>
          <span className="pollline__name">{l.name}</span>
          <span className="pollline__status">{l.status}</span>
        </Link>
      ))}
      {lines.length > MAX_LINES ? <span className="pollline__more">{t('+{count} votações', { count: lines.length - MAX_LINES })}</span> : null}
    </div>
  );
}
