import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { ACTION_LABEL, TARGET_LABEL, formatDateTime } from '../labels.ts';
import { Loadable, PageHead, Pager } from '../ui.tsx';

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const list = useAsync(() => api.audit(offset), [offset]);
  return (
    <>
      <PageHead title="Auditoria" hint="Tudo que a gestão decidiu: quem, o quê, quando e por quê. Só cresce, não dá para apagar." />
      <Loadable state={list} empty="Nenhuma decisão registrada ainda." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O que</th>
                  <th>Alvo</th>
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
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
          </>
        )}
      </Loadable>
    </>
  );
}
