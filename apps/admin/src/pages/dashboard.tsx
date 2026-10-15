import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { go } from '../router.ts';
import type { RoutePath } from '../routes.ts';
import { Loadable, PageHead } from '../ui.tsx';

function Card({ label, value, sub, to, alert }: { label: string; value: number; sub?: string; to?: RoutePath; alert?: boolean }) {
  const body = (
    <>
      <span className="card__label">{label}</span>
      <strong className={alert && value > 0 ? 'card__value card__value--alert' : 'card__value'}>{value}</strong>
      {sub ? <span className="muted small">{sub}</span> : null}
    </>
  );
  return to ? (
    <a className="card card--link" href={to} onClick={(e) => { e.preventDefault(); go(to); }}>
      {body}
    </a>
  ) : (
    <div className="card">{body}</div>
  );
}

export function DashboardPage() {
  const stats = useAsync(() => api.stats(), []);
  return (
    <>
      <PageHead title="Painel" hint="O que precisa de atenção e um retrato do app." />
      <Loadable state={stats} empty="Sem dados." isEmpty={() => false}>
        {(s) => (
          <>
            <h2 className="section">Precisa de você</h2>
            <div className="cards">
              <Card label="Pedidos de donos em análise" value={s.pendingClaims} to="/pedidos" alert />
              <Card label="Denúncias de posts abertas" value={s.openPostReports} to="/denuncias" alert />
              <Card label="Denúncias de conversas abertas" value={s.openConversationReports} to="/denuncias" alert />
            </div>
            <h2 className="section">O app em números</h2>
            <div className="cards">
              <Card label="Pessoas" value={s.users} sub={`${s.suspendedUsers} suspensa(s)`} to="/pessoas" />
              <Card label="Locais" value={s.venues} sub={`${s.venuesWithOwner} com responsável`} to="/locais" />
              <Card label="Eventos de locais" value={s.placeEvents} to="/eventos" />
              <Card label="Eventos de pessoas" value={s.userEvents} to="/posts" />
              <Card label="Posts" value={s.posts} to="/posts" />
            </div>
          </>
        )}
      </Loadable>
    </>
  );
}
