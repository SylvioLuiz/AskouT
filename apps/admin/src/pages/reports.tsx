import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { REASON_LABEL, RESOLUTION_LABEL, formatDateTime } from '../labels.ts';
import type { ConversationReportRow, PostReportRow } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, Tabs } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';
import { PostThumb, deletePostAction } from './posts.tsx';

type Kind = 'posts' | 'conversations';

function Outcome({ r }: { r: { resolution: PostReportRow['resolution']; resolutionNote: string | null; resolvedAt: string | null } }) {
  if (!r.resolution) return null;
  return (
    <div className="outcome">
      <Badge tone={r.resolution === 'ACTIONED' ? 'ok' : 'neutral'}>{RESOLUTION_LABEL[r.resolution]}</Badge> <span className="muted small">{formatDateTime(r.resolvedAt)}</span>
      {r.resolutionNote ? <div className="pre small">{r.resolutionNote}</div> : null}
    </div>
  );
}

function PostReportCard({ r, onAction }: { r: PostReportRow; onAction: (a: ActionSpec) => void }) {
  const open = r.resolution === null;
  return (
    <article className="report">
      <PostThumb post={r.post} />
      <div className="report__main">
        <div>
          <Badge tone="warn">{REASON_LABEL[r.reason]}</Badge> <span className="muted small">denunciado por @{r.reporter.username} em {formatDateTime(r.createdAt)}</span>
        </div>
        {r.details ? <p className="pre">“{r.details}”</p> : null}
        <div className="postbox">
          <div className="muted small">
            Post de <span className="handle">@{r.post.author.username}</span> · {r.post.reportsCount} denúncia(s) no total
          </div>
          {r.post.eventTitle ? <strong>Evento: {r.post.eventTitle}</strong> : null}
          <div className="clip">{r.post.caption ?? <span className="muted">Sem legenda</span>}</div>
        </div>
        <Outcome r={r} />
      </div>
      {open ? (
        <div className="report__actions">
          <button type="button" className="btn btn--small" onClick={() => onAction({ title: 'Denúncia sem problema', description: <p>O post fica no ar e a denúncia sai da fila.</p>, confirmLabel: 'Marcar sem problema', noteLabel: 'Nota', run: (n) => api.resolvePostReport(r.id, 'DISMISSED', n) })}>
            Sem problema
          </button>
          <button type="button" className="btn btn--small" onClick={() => onAction({ title: 'Providência tomada', description: <p>Use quando você já agiu por outro caminho (ex.: falou com a pessoa).</p>, confirmLabel: 'Registrar providência', noteLabel: 'O que foi feito', noteRequired: true, run: (n) => api.resolvePostReport(r.id, 'ACTIONED', n) })}>
            Providência tomada
          </button>
          <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => onAction(deletePostAction(r.post))}>
            Apagar post
          </button>
        </div>
      ) : null}
    </article>
  );
}

function ConversationReportCard({ r, onAction }: { r: ConversationReportRow; onAction: (a: ActionSpec) => void }) {
  const open = r.resolution === null;
  const target = r.reported;
  return (
    <article className="report">
      <div className="report__main">
        <div>
          <Badge tone="warn">{REASON_LABEL[r.reason]}</Badge> <span className="muted small">denunciado por @{r.reporter.username} em {formatDateTime(r.createdAt)}</span>
        </div>
        <p className="muted small">
          {target ? (
            <>
              Pessoa denunciada: <span className="handle">@{target.username}</span> {target.status === 'SUSPENDED' ? <Badge tone="bad">Suspensa</Badge> : null}
            </>
          ) : (
            'Conversa em grupo'
          )}
        </p>
        {r.details ? <p className="pre">“{r.details}”</p> : null}
        <details>
          <summary>Trecho enviado por quem denunciou</summary>
          <pre className="evidence">{r.evidence || 'Nada anexado.'}</pre>
        </details>
        <Outcome r={r} />
      </div>
      {open ? (
        <div className="report__actions">
          <button type="button" className="btn btn--small" onClick={() => onAction({ title: 'Denúncia sem problema', description: <p>A denúncia sai da fila sem nenhuma providência.</p>, confirmLabel: 'Marcar sem problema', noteLabel: 'Nota', run: (n) => api.resolveConversationReport(r.id, 'DISMISSED', n) })}>
            Sem problema
          </button>
          <button type="button" className="btn btn--small" onClick={() => onAction({ title: 'Providência tomada', description: <p>Use quando você já agiu por outro caminho.</p>, confirmLabel: 'Registrar providência', noteLabel: 'O que foi feito', noteRequired: true, run: (n) => api.resolveConversationReport(r.id, 'ACTIONED', n) })}>
            Providência tomada
          </button>
          {target && target.status !== 'SUSPENDED' ? (
            <button
              type="button"
              className="btn btn--small btn--danger-quiet"
              onClick={() =>
                onAction({
                  title: `Suspender @${target.username}`,
                  description: <p>A conta perde o acesso agora e esta denúncia é encerrada como “providência tomada”.</p>,
                  confirmLabel: 'Suspender e encerrar',
                  danger: true,
                  noteLabel: 'Motivo',
                  noteRequired: true,
                  run: async (n) => {
                    await api.setUserStatus(target.id, 'SUSPENDED', n);
                    await api.resolveConversationReport(r.id, 'ACTIONED', n);
                  },
                })
              }
            >
              Suspender @{target.username}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ReportsPage() {
  const [kind, setKind] = useState<Kind>('posts');
  const [resolved, setResolved] = useState(false);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const stats = useAsync(() => api.stats(), []);
  const posts = useAsync(() => (kind === 'posts' ? api.postReports({ resolved, offset }) : Promise.resolve(undefined)), [kind, resolved, offset]);
  const convs = useAsync(() => (kind === 'conversations' ? api.conversationReports({ resolved, offset }) : Promise.resolve(undefined)), [kind, resolved, offset]);

  const reload = () => {
    posts.reload();
    convs.reload();
    stats.reload();
  };

  return (
    <>
      <PageHead title="Denúncias" hint="Decida cada denúncia: a decisão e a nota ficam na auditoria." />
      <div className="toolbar">
        <Tabs
          value={kind}
          onChange={(k) => { setKind(k); setOffset(0); }}
          options={[
            { value: 'posts', label: 'Posts', count: stats.data?.openPostReports },
            { value: 'conversations', label: 'Conversas', count: stats.data?.openConversationReports },
          ]}
        />
        <Tabs value={resolved ? 'done' : 'open'} onChange={(v) => { setResolved(v === 'done'); setOffset(0); }} options={[{ value: 'open', label: 'Abertas' }, { value: 'done', label: 'Decididas' }]} />
      </div>
      {kind === 'posts' ? (
        <Loadable state={posts} empty={resolved ? 'Nenhuma denúncia decidida ainda.' : 'Nenhuma denúncia aberta. 🎉'} isEmpty={(d) => d === undefined || d.items.length === 0}>
          {(page) =>
            page ? (
              <>
                <div className="reports">{page.items.map((r) => <PostReportCard key={r.id} r={r} onAction={setAction} />)}</div>
                <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
              </>
            ) : null
          }
        </Loadable>
      ) : (
        <Loadable state={convs} empty={resolved ? 'Nenhuma denúncia decidida ainda.' : 'Nenhuma denúncia aberta. 🎉'} isEmpty={(d) => d === undefined || d.items.length === 0}>
          {(page) =>
            page ? (
              <>
                <div className="reports">{page.items.map((r) => <ConversationReportCard key={r.id} r={r} onAction={setAction} />)}</div>
                <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
              </>
            ) : null
          }
        </Loadable>
      )}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={reload} /> : null}
    </>
  );
}
