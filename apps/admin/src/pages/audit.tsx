import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { ACTION_LABEL, TARGET_LABEL, formatDateTime } from '../labels.ts';
import { Badge, Loadable, Modal, PageHead, Pager, SortTh } from '../ui.tsx';
import { Mono, PersonLink, RecordLink, RecordView, useReloadOnChange } from '../record.tsx';
import type { RecordKind, RecordSection } from '../record.tsx';
import type { AuditRow } from '../types.ts';
import { useSort } from '../sort.ts';

const TARGET_KIND: Partial<Record<string, RecordKind>> = { USER: 'user', VENUE: 'venue', PLACE_EVENT: 'event', POST: 'post' };

/** Uma decisão da auditoria: quem, o quê, quando, por quê e o alvo (que abre, se ainda existir). Só leitura. */
function AuditDetail({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const kind = TARGET_KIND[row.targetType];
  const sections: RecordSection[] = [
    {
      title: 'Decisão',
      fields: [
        { label: 'O que', value: ACTION_LABEL[row.action] ?? row.action },
        { label: 'Código', value: <Mono>{row.action}</Mono> },
        { label: 'Quando', value: formatDateTime(row.createdAt) },
        { label: 'Quem', value: <PersonLink id={row.adminId} username={row.adminUsername} /> },
        { label: 'Motivo e o que mudou', value: row.note ? <span className="pre">{row.note}</span> : null, wide: true },
        { label: 'ID', value: <Mono>{row.id}</Mono> },
      ],
    },
    {
      title: 'Alvo',
      fields: [
        { label: 'Tipo', value: TARGET_LABEL[row.targetType] ?? row.targetType },
        { label: 'Registro', value: kind ? <RecordLink kind={kind} id={row.targetId}><Mono>{row.targetId}</Mono></RecordLink> : <Mono>{row.targetId}</Mono>, hint: undefined },
      ],
    },
  ];
  return (
    <Modal title="Decisão da auditoria" onClose={onClose} wide bare>
      <RecordView title={ACTION_LABEL[row.action] ?? row.action} subtitle={`@${row.adminUsername} · ${formatDateTime(row.createdAt)}`} status={<Badge>{TARGET_LABEL[row.targetType] ?? row.targetType}</Badge>} sections={sections} onClose={onClose} />
    </Modal>
  );
}

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<AuditRow>();
  const { sort, toggle } = useSort<'createdAt' | 'action' | 'targetType'>();
  const onSort = (column: 'createdAt' | 'action' | 'targetType', first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.audit(offset, sort), [offset, sort]);
  useReloadOnChange(list.reload);
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
                    <td>
                      <button type="button" className="linkbtn" onClick={() => setOpen(r)} aria-label="Ver a decisão">
                        {formatDateTime(r.createdAt)}
                      </button>
                    </td>
                    <td>
                      <PersonLink id={r.adminId} username={r.adminUsername} />
                    </td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td>
                      {TARGET_LABEL[r.targetType] ?? r.targetType}
                      <div className="muted small mono">{TARGET_KIND[r.targetType] ? <RecordLink kind={TARGET_KIND[r.targetType]!} id={r.targetId}>{r.targetId}</RecordLink> : r.targetId}</div>
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
      {open ? <AuditDetail row={open} onClose={() => setOpen(undefined)} /> : null}
    </>
  );
}
