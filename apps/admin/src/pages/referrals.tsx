import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { Loadable, PageHead, RecordCount, SortTh } from '../ui.tsx';
import { PersonLink } from '../record.tsx';
import { sortRows, useSort } from '../sort.ts';

export function ReferralsPage() {
  const list = useAsync(() => api.topInviters(30), []);
  const { sort, toggle } = useSort<'rank' | 'username' | 'brought' | 'confirmed'>();
  return (
    <>
      <PageHead
        title="Convites"
        hint="Quem mais trouxe gente pelo link de convite. “Confirmados” são os convidados que voltaram ao app em outro dia: só eles contam para o selo. Muitos convidados e poucos confirmados é sinal de contas em massa."
      />
      <Loadable state={list} empty="Ninguém convidou ninguém ainda." isEmpty={(d) => d.length === 0}>
        {(rows) => (
          <table className="table">
            <thead>
              <tr>
                <SortTh label="#" column="rank" sort={sort} onSort={toggle} />
                <SortTh label="Quem convidou" column="username" sort={sort} onSort={toggle} />
                <SortTh label="Entraram" column="brought" sort={sort} onSort={toggle} first="desc" />
                <SortTh label="Confirmados" column="confirmed" sort={sort} onSort={toggle} first="desc" />
              </tr>
            </thead>
            <tbody>
              {sortRows(rows.map((r, i) => ({ ...r, rank: i + 1 })), sort, { rank: (r) => r.rank, username: (r) => r.profile.username, brought: (r) => r.brought, confirmed: (r) => r.confirmed }).map((r) => (
                <tr key={r.profile.userId}>
                  <td>{r.rank}</td>
                  <td>
                    <PersonLink id={r.profile.userId} username={r.profile.username} />
                    <div className="muted small">{r.profile.displayName}</div>
                  </td>
                  <td>{r.brought}</td>
                  <td>{r.confirmed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
      {list.data ? <RecordCount count={list.data.length} /> : null}
    </>
  );
}
