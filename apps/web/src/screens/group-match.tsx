import { useState } from 'react';
import { Avatar, Button, EmptyState, ErrorState, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { DATE_FIT_LABEL, GROUP_MAX_FRIENDS, PERIOD_OPTIONS, scoreLabel, togglePerson } from '../lib/group-match.ts';
import { toApiError } from '../lib/errors.ts';
import { kindLabel } from '../lib/explore.ts';
import type { GroupSuggestions } from '../lib/types.ts';
import { Link } from '../router.tsx';

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Escolhe os amigos e mostra rolês que o grupo deve curtir, em dia que dá para todos. */
export function GroupMatchScreen() {
  useTitle('Rolê para o grupo');
  const friends = useAsync(() => api.friends(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState<number>(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<GroupSuggestions | undefined>(undefined);

  async function search() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await api.groupMatch(picked, days));
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  if (friends.loading) return (<><PageHead title="Rolê para o grupo" back="/agenda" /><Loading /></>);
  if (friends.error || !friends.data) return (<><PageHead title="Rolê para o grupo" back="/agenda" /><ErrorState message={friends.error?.message ?? 'Não foi possível carregar.'} onRetry={friends.reload} /></>);

  return (
    <>
      <PageHead title="Rolê para o grupo" back="/agenda" subtitle="Escolha quem vai e veja o que combina com o gosto de vocês." />
      <div className="gm">
        {friends.data.length === 0 ? (
          <EmptyState title="Você ainda não tem amigos no app">Amigo é quem se segue de volta. Siga alguém e peça para seguir você.</EmptyState>
        ) : (
          <>
            <section className="gm__block" aria-labelledby="gm-who">
              <h2 id="gm-who" className="gm__h">Quem vai com você <span className="gm__count">{picked.length}/{GROUP_MAX_FRIENDS}</span></h2>
              <ul className="gm__people">
                {friends.data.map((f) => (
                  <li key={f.userId}>
                    <button type="button" className="gm__person" aria-pressed={picked.includes(f.userId)} onClick={() => { setPicked((p) => togglePerson(p, f.userId)); setResult(undefined); }}>
                      <Avatar profile={f} size={36} />
                      <span>{f.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="gm__block" aria-labelledby="gm-when">
              <h2 id="gm-when" className="gm__h">Nos próximos</h2>
              <div className="optrow" role="radiogroup" aria-labelledby="gm-when">
                {PERIOD_OPTIONS.map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={days === d} aria-pressed={days === d} className="chip" onClick={() => { setDays(d); setResult(undefined); }}>
                    {d} dias
                  </button>
                ))}
              </div>
            </section>

            <Button full loading={busy} disabled={picked.length === 0} onClick={() => void search()}>
              Sugerir rolês
            </Button>
            <p className="gm__hint">Usamos os rolês que cada um segue, os eventos a que foram e a agenda de cada um. Ninguém vê o gosto nem a agenda de outra pessoa, só o resultado do grupo.</p>
          </>
        )}

        {error ? <Notice tone="error">{error}</Notice> : null}

        {result && !result.hasTaste ? (
          <EmptyState title="Ainda não dá para sugerir">Siga alguns rolês ou confirme presença em eventos. Com isso, o app aprende o que vocês curtem.</EmptyState>
        ) : null}
        {result && result.hasTaste && result.items.length === 0 ? (
          <EmptyState title="Nada combinou nesse período">Tente mais dias, ou veja se alguém marcou “não posso” na agenda.</EmptyState>
        ) : null}
        {result && result.items.length > 0 ? (
          <ul className="gm__list">
            {result.items.map((s) => (
              <li key={s.event.id} className="gm__item">
                <Link to={`/eventos/${encodeURIComponent(s.event.id)}`} className="gm__link">
                  <div className="gm__row">
                    <strong>{s.event.title}</strong>
                    <span className="gm__score" aria-label={`${scoreLabel(s.score)}, nota ${s.score} de 100`}>{s.score}</span>
                  </div>
                  <div className="gm__meta">{s.event.venueName} · {kindLabel(s.event.kind)} · {when(s.event.startsAt)}{s.event.isFree ? ' · Grátis' : ''}</div>
                  <ul className="gm__reasons">
                    <li>{scoreLabel(s.score)}</li>
                    {s.reasons.map((r) => (<li key={r}>{r}</li>))}
                    <li className="gm__date">{DATE_FIT_LABEL[s.dateFit]}</li>
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
