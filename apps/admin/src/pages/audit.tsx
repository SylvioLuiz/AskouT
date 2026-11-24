import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { ACTION_LABEL, TARGET_LABEL, formatDateTime } from '../labels.ts';
import { Loadable, PageHead, Pager, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const { sort, toggle } = useSort<'createdAt' | 'action' | 'targetType'>();
  const onSort = (column: 'createdAt' | 'action' | 'targetType', first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.audit(offset, sort), [offset, sort]);
  return (
    <>
      <PageHead title="Auditoria" hint="Tudo que a gestão decidiu: quem, o quê, quando e por quê. Só cresce, não dá para apagar." />
      <Loadable state={list} empty="Nenhuma decisão registrada ainda." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Quando" column="createdAt" sort={sort} onSort={onSort} first="desc" />
                  <th>Quem</th>
                  <SortTh label="O que" column="action" sort={sort} onSort={onSort} />
                  <SortTh label="Alvo" column="targetType" sort={sort} onSort={onSort} />
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>
                      <span className="handle">@{r.adminUsername}</span>
                    </td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td>
                      {TARGET_LABEL[r.targetType] ?? r.targetType}
                      <div className="muted small mono">{r.targetId}</div>
                    </td>
                    <td className="pre">{r.note ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
          </>
        )}
      </Loadable>
    </>
  );
}
