import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { markShown, readLastShown, shouldShowSuggestions } from '../lib/suggested-people.ts';
import { Link } from '../router.tsx';
import { Avatar } from './ui.tsx';

/** "Pessoas que você talvez conheça": amigos de amigos, em carrossel. Aparece de 3 em 3 dias (sempre, se você segue menos de 5 pessoas). */
export function SuggestedPeople() {
  const data = useAsync(() => api.suggestedPeople(), []);
  // A decisão vale para a visita inteira: o carimbo é gravado uma vez e o bloco não some no meio da leitura.
  const [decision] = useState(() => ({ lastShownAt: readLastShown(), now: Date.now() }));
  const [stamped, setStamped] = useState(false);
  const items = data.data?.items ?? [];
  const show = data.data !== undefined && items.length > 0 && shouldShowSuggestions(data.data.followingCount, decision.lastShownAt, decision.now);
  if (show && !stamped) {
    markShown(decision.now);
    setStamped(true);
  }
  if (!show) return null;
  return (
    <section className="section suggest" aria-labelledby="talvez-titulo">
      <div className="section__head">
        <h2 id="talvez-titulo" className="section__title">
          Pessoas que você talvez conheça
        </h2>
        <Link to="/amigos/contatos">Achar nos contatos</Link>
      </div>
      <ul className="suggest__track">
        {items.map((p) => (
          <li key={p.userId} className="suggest__card">
            <Link to={`/u/${encodeURIComponent(p.username)}`} className="suggest__link">
              <Avatar profile={p} size={72} />
              <span className="suggest__name">{p.username}</span>
              <span className="suggest__mutual">{p.mutualCount === 1 ? '1 amigo em comum' : `${p.mutualCount} amigos em comum`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
