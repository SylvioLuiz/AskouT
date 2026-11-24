import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { STATUS_LABEL, formatBirthDate, formatDate } from '../labels.ts';
import type { UserRow, UserStatus } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';
import { UserActivityDialog, reactivateAction, suspendAction } from './user-dialogs.tsx';
import { useOpenRecord, useReloadOnChange } from '../record.tsx';

type UserSort = 'username' | 'email' | 'status' | 'posts' | 'birthDate' | 'createdAt';

export function UsersPage() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const [watching, setWatching] = useState<UserRow>();
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<UserSort>();
  const onSort = (column: UserSort, first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.users({ q, status: status || undefined, offset, sort }), [q, status, offset, sort]);
  useReloadOnChange(list.reload);
  const openRecord = useOpenRecord();
  const setViewing = (u: UserRow) => openRecord({ kind: 'user', id: u.id });

  function suspend(u: UserRow) {
    setAction(suspendAction(u));
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
    setAction(reactivateAction(u));
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
                  <SortTh label="Pessoa" column="username" sort={sort} onSort={onSort} />
                  <SortTh label="E-mail" column="email" sort={sort} onSort={onSort} />
                  <SortTh label="Situação" column="status" sort={sort} onSort={onSort} />
                  <th>Login</th>
                  <SortTh label="Posts" column="posts" sort={sort} onSort={onSort} first="desc" className="num" />
                  <th className="num">Denúncias</th>
                  <SortTh label="Nascimento" column="birthDate" sort={sort} onSort={onSort} first="desc" />
                  <SortTh label="Desde" column="createdAt" sort={sort} onSort={onSort} first="desc" />
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button type="button" className="linkbtn" onClick={() => setViewing(u)} aria-label={`Ver detalhes de @${u.username}`}>
                        <strong>{u.displayName}</strong> <span className="handle">@{u.username}</span>
                      </button>
                      {u.role === 'ADMIN' ? <> <Badge tone="admin">Admin</Badge></> : null}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <Badge tone={u.status === 'ACTIVE' ? 'ok' : u.status === 'SUSPENDED' ? 'bad' : 'warn'}>{STATUS_LABEL[u.status]}</Badge>
                    </td>
                    <td>
                      {(u.loginProviders ?? []).length === 0 ? (
                        <span className="handle">E-mail</span>
                      ) : (
                        (u.loginProviders ?? []).map((p) => (
                          <span key={p}>
                            <Badge tone="info">{p === 'APPLE' ? 'Apple' : 'Google'}</Badge>{' '}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="num">{u.postsCount}</td>
                    <td className="num">{u.reportsCount > 0 ? <strong className="alert">{u.reportsCount}</strong> : 0}</td>
                    <td>{formatBirthDate(u.birthDate)}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td className="right">
                      <button type="button" className="btn btn--small" onClick={() => setViewing(u)}>
                        Detalhes
                      </button>{' '}
                      <button type="button" className="btn btn--small" onClick={() => setWatching(u)}>
                        Atividade
                      </button>{' '}
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
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
      {watching ? <UserActivityDialog user={watching} onClose={() => setWatching(undefined)} /> : null}
    </>
  );
}
