import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { Loadable, PageHead, RecordCount, UserLink } from '../ui.tsx';

export function ReferralsPage() {
  const list = useAsync(() => api.topInviters(30), []);
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
                <th>#</th>
                <th>Quem convidou</th>
                <th>Entraram</th>
                <th>Confirmados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.profile.userId}>
                  <td>{i + 1}</td>
                  <td>
                    <UserLink username={r.profile.username} />
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
