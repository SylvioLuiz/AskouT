import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { ACTION_GROUPS, ACTION_LABEL, ACTOR_KIND_LABEL, TARGET_LABEL, formatDateTime } from '../labels.ts';
import { Badge, Loadable, Modal, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { LinkedList, Mono, PersonLink, RecordLink, RecordView, useReloadOnChange } from '../record.tsx';
import type { RecordKind, RecordSection } from '../record.tsx';
import type { AuditActorKind, AuditChange, AuditFilter, AuditRow } from '../types.ts';
import { useSort } from '../sort.ts';

const TARGET_KIND: Partial<Record<string, RecordKind>> = { USER: 'user', VENUE: 'venue', PLACE_EVENT: 'event', POST: 'post' };

const ACTOR_TONE: Record<AuditActorKind, 'admin' | 'info' | 'neutral'> = { ADMIN: 'admin', USER: 'info', SYSTEM: 'neutral' };

/** Ações que ninguém da gestão fez (pessoa no app ou sistema) aparecem com um selo. */
function Actor({ row }: { row: AuditRow }) {
  const kind = row.actorKind ?? 'ADMIN';
  return (
    <>
      {row.adminId ? <PersonLink id={row.adminId} username={row.adminUsername} /> : null}
      {kind !== 'ADMIN' ? (
        <div className="audit-actor">
          <Badge tone={ACTOR_TONE[kind]}>{ACTOR_KIND_LABEL[kind]}</Badge>
        </div>
      ) : null}
    </>
  );
}

function Target({ row, compact }: { row: AuditRow; compact?: boolean }) {
  const kind = TARGET_KIND[row.targetType];
  const type = TARGET_LABEL[row.targetType] ?? row.targetType;
  const name = row.targetLabel ?? (compact ? null : row.targetId);
  return (
    <>
      {name ? kind ? <RecordLink kind={kind} id={row.targetId}>{name}</RecordLink> : <span>{name}</span> : null}
      <div className="muted small">
        {type}
        {row.targetLabel && !compact ? <> · <span className="mono">{row.targetId}</span></> : null}
      </div>
    </>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const show = (v: string | null) => (v === null || v === '' ? <span className="muted">(vazio)</span> : ISO.test(v) ? formatDateTime(v) : v);

/** O que mudou, campo a campo. */
function Changes({ changes, limit }: { changes: AuditChange[] | null; limit?: number }) {
  if (!changes || changes.length === 0) return null;
  const shown = limit ? changes.slice(0, limit) : changes;
  return (
    <ul className="audit-changes">
      {shown.map((c, i) => (
        <li key={`${c.field}-${i}`}>
          <span className="muted">{c.field}:</span>{' '}
          {c.before === null ? <strong>{show(c.after)}</strong> : c.after === null ? <span>{show(c.before)}</span> : <><s className="audit-before">{show(c.before)}</s> → <strong>{show(c.after)}</strong></>}
        </li>
      ))}
      {limit && changes.length > limit ? <li className="muted small">e mais {changes.length - limit}…</li> : null}
    </ul>
  );
}

/** Um registro da auditoria: quem, o quê, quando, por quê, o alvo e o antes/depois. Só leitura. */
function AuditDetail({ row, onClose, onFilter }: { row: AuditRow; onClose: () => void; onFilter?: (f: AuditFilter) => void }) {
  const kind = TARGET_KIND[row.targetType];
  const filterBy = (f: AuditFilter) => {
    onFilter?.(f);
    onClose();
  };
  const sections: RecordSection[] = [
    {
      title: 'Registro',
      fields: [
        { label: 'O que', value: ACTION_LABEL[row.action] ?? row.action },
        { label: 'Código', value: <Mono>{row.action}</Mono> },
        { label: 'Quando', value: formatDateTime(row.createdAt) },
        { label: 'Quem', value: <Actor row={row} /> },
        { label: 'Origem', value: ACTOR_KIND_LABEL[row.actorKind ?? 'ADMIN'] },
        { label: 'Motivo e detalhes', value: row.note ? <span className="pre">{row.note}</span> : null, wide: true },
        { label: 'ID', value: <Mono>{row.id}</Mono> },
      ],
    },
    {
      title: 'Alvo',
      fields: [
        { label: 'Tipo', value: TARGET_LABEL[row.targetType] ?? row.targetType },
        { label: 'Nome na época', value: row.targetLabel },
        { label: 'Registro', value: kind ? <RecordLink kind={kind} id={row.targetId}><Mono>{row.targetId}</Mono></RecordLink> : <Mono>{row.targetId}</Mono> },
      ],
    },
    {
      title: 'O que mudou',
      count: row.changes?.length ?? 0,
      hidden: !row.changes || row.changes.length === 0,
      children: (
        <table className="table audit-diff">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Antes</th>
              <th>Depois</th>
            </tr>
          </thead>
          <tbody>
            {(row.changes ?? []).map((c, i) => (
              <tr key={`${c.field}-${i}`}>
                <td>{c.field}</td>
                <td className="pre">{show(c.before)}</td>
                <td className="pre">{show(c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
    {
      title: 'Ver mais na auditoria',
      hidden: !onFilter,
      children: (
        <div className="audit-more">
          <button type="button" className="btn" onClick={() => filterBy({ targetId: row.targetId })}>Tudo deste alvo</button>
          {row.adminId ? <button type="button" className="btn" onClick={() => filterBy({ actorId: row.adminId! })}>Tudo de @{row.adminUsername}</button> : null}
          <button type="button" className="btn" onClick={() => filterBy({ action: row.action })}>Só “{ACTION_LABEL[row.action] ?? row.action}”</button>
        </div>
      ),
    },
  ];
  return (
    <Modal title="Registro da auditoria" onClose={onClose} wide bare>
      <RecordView
        title={ACTION_LABEL[row.action] ?? row.action}
        subtitle={`${row.adminId ? `@${row.adminUsername}` : 'Sistema'} · ${formatDateTime(row.createdAt)}`}
        status={<Badge tone={ACTOR_TONE[row.actorKind ?? 'ADMIN']}>{TARGET_LABEL[row.targetType] ?? row.targetType}</Badge>}
        sections={sections}
        onClose={onClose}
      />
    </Modal>
  );
}

const EMPTY: AuditFilter = {};

function hasFilter(f: AuditFilter, text: string): boolean {
  return text.trim() !== '' || Object.values(f).some((v) => v !== undefined && v !== '');
}

export function AuditPage() {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<AuditRow>();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<'createdAt' | 'action' | 'targetType'>();
  const onSort = (column: 'createdAt' | 'action' | 'targetType', first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const change = (patch: AuditFilter) => {
    setFilter((f) => ({ ...f, ...patch }));
    setOffset(0);
  };
  const full: AuditFilter = { ...filter, ...(q ? { q } : {}) };
  const list = useAsync(() => api.audit(offset, sort, full), [offset, sort, JSON.stringify(full)]);
  useReloadOnChange(list.reload);
  const known = new Set(ACTION_GROUPS.flatMap((g) => g.actions));
  const pinned: ReactNode[] = [];
  if (filter.actorId) pinned.push(<Badge key="a" tone="info">Quem fez: <Mono>{filter.actorId.slice(0, 8)}</Mono></Badge>);
  if (filter.targetId) pinned.push(<Badge key="t" tone="info">Alvo: <Mono>{filter.targetId.slice(0, 12)}</Mono></Badge>);
  return (
    <>
      <PageHead title="Auditoria" hint="O que a gestão decidiu, as ações sensíveis de quem usa o app (apagar conta, pagar impulsionamento…) e o que o sistema fez. Quem, o quê, alvo e o antes/depois. Só cresce, não dá para apagar.">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar motivo, alvo ou @…" label="Buscar na auditoria" />
      </PageHead>
      <div className="audit-filters">
        <select className="select" aria-label="Quem fez" value={filter.actorKind ?? ''} onChange={(e) => change({ actorKind: (e.target.value || undefined) as AuditActorKind | undefined })}>
          <option value="">Qualquer origem</option>
          <option value="ADMIN">Gestão</option>
          <option value="USER">Pessoa no app</option>
          <option value="SYSTEM">Sistema</option>
        </select>
        <select className="select" aria-label="O que" value={filter.action ?? ''} onChange={(e) => change({ action: e.target.value || undefined })}>
          <option value="">Qualquer ação</option>
          {ACTION_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>)}
            </optgroup>
          ))}
          {filter.action && !known.has(filter.action) ? <option value={filter.action}>{ACTION_LABEL[filter.action] ?? filter.action}</option> : null}
        </select>
        <select className="select" aria-label="Tipo de alvo" value={filter.targetType ?? ''} onChange={(e) => change({ targetType: e.target.value || undefined })}>
          <option value="">Qualquer alvo</option>
          {Object.entries(TARGET_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="audit-date">
          <span className="muted small">De</span>
          <input className="select" type="date" value={filter.from ?? ''} max={filter.to} onChange={(e) => change({ from: e.target.value || undefined })} />
        </label>
        <label className="audit-date">
          <span className="muted small">Até</span>
          <input className="select" type="date" value={filter.to ?? ''} min={filter.from} onChange={(e) => change({ to: e.target.value || undefined })} />
        </label>
        {pinned}
        {hasFilter(filter, text) ? (
          <button type="button" className="linkbtn small" onClick={() => { setFilter(EMPTY); setText(''); setOffset(0); }}>Limpar filtros</button>
        ) : null}
      </div>
      <Loadable state={list} empty={hasFilter(filter, text) ? 'Nada encontrado com esses filtros.' : 'Nenhum registro ainda.'} isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Quando" column="createdAt" sort={sort} onSort={onSort} first="desc" />
                  <th>Quem</th>
                  <SortTh label="O que" column="action" sort={sort} onSort={onSort} />
                  <SortTh label="Alvo" column="targetType" sort={sort} onSort={onSort} />
                  <th>Motivo e o que mudou</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="linkbtn" onClick={() => setOpen(r)} aria-label="Ver o registro">
                        {formatDateTime(r.createdAt)}
                      </button>
                    </td>
                    <td>
                      <Actor row={r} />
                    </td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td>
                      <Target row={r} />
                    </td>
                    <td>
                      {r.note ? <div className="pre">{r.note}</div> : null}
                      <Changes changes={r.changes} limit={3} />
                      {!r.note && !r.changes?.length ? <span className="muted">—</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {open ? <AuditDetail row={open} onClose={() => setOpen(undefined)} onFilter={(f) => { setFilter(f); setText(''); setOffset(0); }} /> : null}
    </>
  );
}

/** Os últimos registros da auditoria sobre um alvo ou feitos por uma conta, para o detalhe de pessoa ou local. */
export function AuditTrail({ filter, empty }: { filter: AuditFilter; empty: string }) {
  const [open, setOpen] = useState<AuditRow>();
  const list = useAsync(() => api.audit(0, undefined, filter, 10), [JSON.stringify(filter)]);
  return (
    <>
      <Loadable state={list} empty={empty} isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <LinkedList
            items={page.items}
            total={page.total}
            empty={empty}
            keyOf={(r) => r.id}
            render={(r) => ({
              main: (
                <>
                  <button type="button" className="linkbtn" onClick={() => setOpen(r)}>{ACTION_LABEL[r.action] ?? r.action}</button>{' '}
                  <span className="muted small">
                    por {r.adminId ? `@${r.adminUsername}` : 'sistema'}
                    {r.targetLabel && !filter.targetId ? ` · ${r.targetLabel}` : ''}
                  </span>
                  {r.note ? <div className="muted small clip">{r.note}</div> : null}
                </>
              ),
              side: formatDateTime(r.createdAt),
            })}
          />
        )}
      </Loadable>
      {open ? <AuditDetail row={open} onClose={() => setOpen(undefined)} /> : null}
    </>
  );
}
