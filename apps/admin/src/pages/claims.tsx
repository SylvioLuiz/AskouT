import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { CLAIM_LABEL, formatDateTime } from '../labels.ts';
import type { Claim, ClaimStatus } from '../types.ts';
import { Badge, Loadable, Modal, PageHead, RecordCount, SortTh, Tabs } from '../ui.tsx';
import { Mono, PersonLink, RecordLink, RecordView, YesNo } from '../record.tsx';
import type { RecordSection } from '../record.tsx';
import { sortRows, useSort } from '../sort.ts';

function DocumentViewer({ claim }: { claim: Claim }) {
  const [doc, setDoc] = useState<{ url: string; mime: string }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    let alive = true;
    api.claimDocument(claim.id).then(
      (d) => {
        url = d.url;
        if (alive) setDoc(d);
      },
      (e: unknown) => alive && setError(e instanceof Error ? e.message : 'Não foi possível abrir o documento.'),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [claim.id]);
  if (error) return <p className="notice notice--bad">{error}</p>;
  if (!doc) return <p className="muted">Abrindo o documento…</p>;
  return doc.mime.startsWith('image/') ? (
    <img className="doc" src={doc.url} alt={`Documento enviado por @${claim.user.username} para ${claim.venue.name}`} />
  ) : (
    <iframe className="doc doc--pdf" src={doc.url} title={`Documento enviado por @${claim.user.username} para ${claim.venue.name}`} />
  );
}

function ClaimDetail({ claim, onClose, onChanged }: { claim: Claim; onClose: () => void; onChanged: () => void }) {
  const pending = claim.status === 'PENDING';
  const takenByOther = claim.venue.ownerId !== null && claim.venue.ownerId !== claim.user.id;
  const kind = claim.venue.isOrganization ? 'Organização nova' : claim.venue.isUserCreated ? 'Local novo (criado do zero)' : 'Local já cadastrado';
  const sections: RecordSection[] = [
    {
      title: 'Pedido',
      fields: [
        { label: 'Situação', value: <Badge tone={claim.status === 'APPROVED' ? 'ok' : claim.status === 'REJECTED' ? 'bad' : 'warn'}>{CLAIM_LABEL[claim.status]}</Badge> },
        { label: 'Enviado em', value: formatDateTime(claim.createdAt) },
        { label: 'Decidido em', value: claim.reviewedAt ? formatDateTime(claim.reviewedAt) : null },
        { label: 'Mensagem', value: claim.note ? <span className="pre">{claim.note}</span> : null, wide: true },
        { label: 'Nota da decisão', value: claim.reviewNote ? <span className="pre">{claim.reviewNote}</span> : null, wide: true },
        { label: 'Documento', value: claim.documentMime },
        { label: 'ID', value: <Mono>{claim.id}</Mono> },
      ],
    },
    {
      title: 'Local',
      fields: [
        { label: 'Tipo de pedido', value: kind },
        { label: 'Local', value: <RecordLink kind="venue" id={claim.venue.id}>{claim.venue.name}</RecordLink> },
        { label: 'Categoria', value: claim.venue.category ?? null },
        { label: 'Endereço', value: claim.venue.address },
        { label: 'Descrição', value: claim.venue.description ?? null, wide: true },
        { label: 'Dado de teste', value: <YesNo value={claim.venue.isSample} /> },
        { label: 'Já tem responsável', value: claim.venue.ownerId ? (takenByOther ? <RecordLink kind="user" id={claim.venue.ownerId}>Sim, outra pessoa</RecordLink> : 'Sim, quem pede') : 'Não' },
      ],
    },
    {
      title: 'Quem pede',
      fields: [
        { label: 'Pessoa', value: <PersonLink id={claim.user.id} username={claim.user.username} displayName={claim.user.displayName} /> },
        { label: 'E-mail', value: claim.user.email },
      ],
    },
    { title: 'Documento enviado', children: <DocumentViewer claim={claim} /> },
  ];
  return (
    <Modal title={`Pedido para ${claim.venue.name}`} onClose={onClose} wide bare>
      {pending && takenByOther ? <p className="notice notice--warn">Este local já tem outro responsável. Aprovar troca o responsável.</p> : null}
      <RecordView
        title={`Pedido para ${claim.venue.name}`}
        subtitle={`de @${claim.user.username} · ${formatDateTime(claim.createdAt)}`}
        status={<Badge tone={claim.status === 'APPROVED' ? 'ok' : claim.status === 'REJECTED' ? 'bad' : 'warn'}>{CLAIM_LABEL[claim.status]}</Badge>}
        sections={sections}
        actions={[
          {
            label: 'Recusar',
            danger: true,
            hidden: !pending,
            confirm: {
              title: 'Recusar pedido',
              description: <p>@{claim.user.username} será avisada de que o pedido para {claim.venue.name} foi recusado, com a sua nota.</p>,
              confirmLabel: 'Recusar',
              danger: true,
              noteLabel: 'Motivo para a pessoa',
              noteRequired: true,
              run: (note) => api.reviewClaim(claim.id, 'REJECTED', note),
            },
          },
          {
            label: 'Aprovar',
            hidden: !pending,
            confirm: {
              title: 'Aprovar pedido',
              description: <p>@{claim.user.username} passa a administrar {claim.venue.name} e poderá criar e editar os eventos do local. Outros pedidos para este local são recusados.</p>,
              confirmLabel: 'Aprovar',
              noteLabel: 'Nota',
              run: (note) => api.reviewClaim(claim.id, 'APPROVED', note),
            },
          },
        ]}
        onClose={onClose}
        onChanged={() => {
          onChanged();
          onClose();
        }}
      />
    </Modal>
  );
}

export function ClaimsPage() {
  const [status, setStatus] = useState<ClaimStatus>('PENDING');
  const [open, setOpen] = useState<Claim>();
  const list = useAsync(() => api.claims(status), [status]);
  const { sort, toggle } = useSort<'venue' | 'user' | 'createdAt'>();
  const counts = useAsync(() => api.stats().then((s) => ({ pending: s.pendingClaims, approved: s.approvedClaims })), []);
  return (
    <>
      <PageHead title="Pedidos de donos" hint="Quem quer administrar um local. Confira o documento antes de aprovar." />
      <Tabs
        value={status}
        onChange={setStatus}
        options={[
          { value: 'PENDING', label: 'Em análise', count: counts.data?.pending },
          { value: 'APPROVED', label: 'Aprovados', count: counts.data?.approved, quiet: true },
          { value: 'REJECTED', label: 'Recusados' },
        ]}
      />
      <Loadable state={list} empty={status === 'PENDING' ? 'Nenhum pedido em análise. 🎉' : 'Nada por aqui.'} isEmpty={(d) => d.length === 0}>
        {(claims) => (
          <table className="table">
            <thead>
              <tr>
                <SortTh label="Local" column="venue" sort={sort} onSort={toggle} />
                <SortTh label="Quem pede" column="user" sort={sort} onSort={toggle} />
                <SortTh label="Enviado em" column="createdAt" sort={sort} onSort={toggle} first="desc" />
                <th>Situação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {sortRows(claims, sort, { venue: (c) => c.venue.name, user: (c) => c.user.username, createdAt: (c) => Date.parse(c.createdAt) }).map((c) => (
                <tr key={c.id}>
                  <td>
                    <RecordLink kind="venue" id={c.venue.id}>
                      <strong>{c.venue.name}</strong>
                    </RecordLink>
                    {c.venue.isOrganization ? <div className="muted small">Organização · {c.venue.category ?? 'universitária'}</div> : null}
                    {c.venue.isUserCreated ? <div className="muted small">Local novo{c.venue.category ? ` · ${c.venue.category}` : ''}</div> : null}
                    <div className="muted small">{c.venue.address ?? 'Sem endereço'}</div>
                  </td>
                  <td>
                    <PersonLink id={c.user.id} username={c.user.username} displayName={c.user.displayName} />
                    <div className="muted small">{c.user.email}</div>
                  </td>
                  <td>{formatDateTime(c.createdAt)}</td>
                  <td>
                    <Badge tone={c.status === 'APPROVED' ? 'ok' : c.status === 'REJECTED' ? 'bad' : 'warn'}>{CLAIM_LABEL[c.status]}</Badge>
                  </td>
                  <td className="right">
                    <button type="button" className="btn btn--small" onClick={() => setOpen(c)}>
                      {c.status === 'PENDING' ? 'Analisar' : 'Ver'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
      {list.data ? <RecordCount count={list.data.length} /> : null}
      {open ? <ClaimDetail claim={open} onClose={() => setOpen(undefined)} onChanged={() => { list.reload(); counts.reload(); }} /> : null}
    </>
  );
}
