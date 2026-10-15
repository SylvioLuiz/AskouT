import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { CLAIM_LABEL, formatDateTime } from '../labels.ts';
import type { Claim, ClaimStatus } from '../types.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, Tabs } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

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
  const [action, setAction] = useState<ActionSpec>();
  const pending = claim.status === 'PENDING';
  const takenByOther = claim.venue.ownerId !== null && claim.venue.ownerId !== claim.user.id;
  return (
    <Modal title={`Pedido para ${claim.venue.name}`} onClose={onClose} wide>
      <div className="split">
        <div>
          <dl className="facts">
            <dt>Local</dt>
            <dd>
              {claim.venue.name}
              {claim.venue.isSample ? ' [TESTE]' : ''}
              <div className="muted small">{claim.venue.address ?? 'Sem endereço'}</div>
            </dd>
            <dt>Quem pede</dt>
            <dd>
              {claim.user.displayName} <span className="handle">@{claim.user.username}</span>
              <div className="muted small">{claim.user.email}</div>
            </dd>
            <dt>Enviado em</dt>
            <dd>{formatDateTime(claim.createdAt)}</dd>
            <dt>Situação</dt>
            <dd>
              <Badge tone={claim.status === 'APPROVED' ? 'ok' : claim.status === 'REJECTED' ? 'bad' : 'warn'}>{CLAIM_LABEL[claim.status]}</Badge>
            </dd>
            {claim.note ? (
              <>
                <dt>Mensagem</dt>
                <dd className="pre">{claim.note}</dd>
              </>
            ) : null}
            {claim.reviewNote ? (
              <>
                <dt>Nota da decisão</dt>
                <dd className="pre">{claim.reviewNote}</dd>
              </>
            ) : null}
          </dl>
          {pending && takenByOther ? <p className="notice notice--warn">Este local já tem outro responsável. Aprovar troca o responsável.</p> : null}
        </div>
        <div>
          <DocumentViewer claim={claim} />
        </div>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>
          Fechar
        </button>
        {pending ? (
          <>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() =>
                setAction({
                  title: 'Recusar pedido',
                  description: <p>@{claim.user.username} será avisada de que o pedido para {claim.venue.name} foi recusado, com a sua nota.</p>,
                  confirmLabel: 'Recusar',
                  danger: true,
                  noteLabel: 'Motivo para a pessoa',
                  noteRequired: true,
                  run: (note) => api.reviewClaim(claim.id, 'REJECTED', note),
                })
              }
            >
              Recusar
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                setAction({
                  title: 'Aprovar pedido',
                  description: <p>@{claim.user.username} passa a administrar {claim.venue.name} e poderá criar e editar os eventos do local. Outros pedidos para este local são recusados.</p>,
                  confirmLabel: 'Aprovar',
                  noteLabel: 'Nota',
                  run: (note) => api.reviewClaim(claim.id, 'APPROVED', note),
                })
              }
            >
              Aprovar
            </button>
          </>
        ) : null}
      </div>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={() => { onChanged(); onClose(); }} /> : null}
    </Modal>
  );
}

export function ClaimsPage() {
  const [status, setStatus] = useState<ClaimStatus>('PENDING');
  const [open, setOpen] = useState<Claim>();
  const list = useAsync(() => api.claims(status), [status]);
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
                <th>Local</th>
                <th>Quem pede</th>
                <th>Enviado em</th>
                <th>Situação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.venue.name}</strong>
                    <div className="muted small">{c.venue.address ?? 'Sem endereço'}</div>
                  </td>
                  <td>
                    {c.user.displayName} <span className="handle">@{c.user.username}</span>
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
      {open ? <ClaimDetail claim={open} onClose={() => setOpen(undefined)} onChanged={() => { list.reload(); counts.reload(); }} /> : null}
    </>
  );
}
