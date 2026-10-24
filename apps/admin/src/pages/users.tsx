import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { STATUS_LABEL, formatBirthDate, formatDate } from '../labels.ts';
import type { UserRow, UserStatus } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

export function UsersPage() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const q = useDebounced(text.trim());
  const list = useAsync(() => api.users({ q, status: status || undefined, offset }), [q, status, offset]);

  function suspend(u: UserRow) {
    setAction({
      title: `Suspender @${u.username}`,
      description: <p>A conta perde o acesso agora: as sessões abertas caem e o login fica bloqueado até você reativar.</p>,
      confirmLabel: 'Suspender',
      danger: true,
      noteLabel: 'Motivo',
      noteRequired: true,
      run: (note) => api.setUserStatus(u.id, 'SUSPENDED', note),
    });
  }
  function fixBirth(u: UserRow) {
    setAction({
      title: `Corrigir data de nascimento de @${u.username}`,
      description: (
        <p>
          Data hoje: <strong>{u.birthDate ? formatBirthDate(u.birthDate) : 'não informada'}</strong>. Use só para erro de digitação, depois de conferir com a pessoa. A data precisa indicar 18 anos ou mais. A data antiga e a nova ficam na auditoria.
        </p>
      ),
      confirmLabel: 'Corrigir data',
      dateLabel: 'Data de nascimento correta',
      dateInitial: u.birthDate ?? '',
      noteLabel: 'Motivo',
      noteRequired: true,
      run: (note, date) => api.setUserBirthDate(u.id, date, note),
    });
  }
  function reactivate(u: UserRow) {
    setAction({
      title: `Reativar @${u.username}`,
      description: <p>A conta volta a poder entrar no AskouT.</p>,
      confirmLabel: 'Reativar',
      noteLabel: 'Nota',
      run: (note) => api.setUserStatus(u.id, 'ACTIVE', note),
    });
  }

  return (
    <>
      <PageHead title="Pessoas" hint="Busque por e-mail, @usuário ou nome.">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar pessoa…" label="Buscar pessoa" />
        <select className="select" aria-label="Situação da conta" value={status} onChange={(e) => { setStatus(e.target.value as UserStatus | ''); setOffset(0); }}>
          <option value="">Todas</option>
          <option value="ACTIVE">Ativas</option>
          <option value="SUSPENDED">Suspensas</option>
          <option value="DELETION_REQUESTED">Exclusão pedida</option>
        </select>
      </PageHead>
      <Loadable state={list} empty="Ninguém encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>E-mail</th>
                  <th>Situação</th>
                  <th className="num">Posts</th>
                  <th className="num">Denúncias</th>
                  <th>Nascimento</th>
                  <th>Desde</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.displayName}</strong> <span className="handle">@{u.username}</span>
                      {u.role === 'ADMIN' ? <> <Badge tone="info">Admin</Badge></> : null}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <Badge tone={u.status === 'ACTIVE' ? 'ok' : u.status === 'SUSPENDED' ? 'bad' : 'warn'}>{STATUS_LABEL[u.status]}</Badge>
                    </td>
                    <td className="num">{u.postsCount}</td>
                    <td className="num">{u.reportsCount > 0 ? <strong className="alert">{u.reportsCount}</strong> : 0}</td>
                    <td>{formatBirthDate(u.birthDate)}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td className="right">
                      {u.role === 'ADMIN' ? null : (
                        <button type="button" className="btn btn--small" onClick={() => fixBirth(u)}>
                          Corrigir idade
                        </button>
                      )}{' '}
                      {u.role === 'ADMIN' ? null : u.status === 'SUSPENDED' ? (
                        <button type="button" className="btn btn--small" onClick={() => reactivate(u)}>
                          Reativar
                        </button>
                      ) : (
                        <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => suspend(u)}>
                          Suspender
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
