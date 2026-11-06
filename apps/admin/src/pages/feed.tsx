import { useState } from 'react';
import { api, appUrl, feedImageUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { formatDateTime } from '../labels.ts';
import type { FeedCommentRow, FeedPostRow } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox, Tabs } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

type Filter = 'all' | 'pending' | 'published';

const PLACE_LABEL: Record<FeedPostRow['place']['type'], string> = { PLACE_EVENT: 'Evento do local', USER_EVENT: 'Evento de pessoa', VENUE: 'Rolê' };

export function FeedThumb({ post }: { post: FeedPostRow }) {
  const first = post.imageIds[0];
  return first ? <img className="thumb" src={feedImageUrl(first)} alt="" loading="lazy" /> : <div className="thumb thumb--empty" aria-hidden="true" />;
}

export function deleteFeedPostAction(post: FeedPostRow): ActionSpec {
  return {
    title: 'Apagar publicação',
    description: <p>A publicação de @{post.author.username} sai do feed de “{post.place.title}”, com fotos, comentários e denúncias. Isso não pode ser desfeito.</p>,
    confirmLabel: 'Apagar publicação',
    danger: true,
    noteLabel: 'Motivo',
    noteRequired: true,
    run: (note) => api.deleteFeedPost(post.id, note),
  };
}

export function deleteFeedCommentAction(comment: { id: string; author?: { username: string } }): ActionSpec {
  return {
    title: 'Apagar comentário',
    description: <p>O comentário{comment.author ? ` de @${comment.author.username}` : ''} sai da publicação, com as denúncias dele. Isso não pode ser desfeito.</p>,
    confirmLabel: 'Apagar comentário',
    danger: true,
    noteLabel: 'Motivo',
    noteRequired: true,
    run: (note) => api.deleteFeedComment(comment.id, note),
  };
}

/** Cabeçalho da publicação: onde está, quem publicou, situação e texto. */
export function FeedPostSummary({ post }: { post: FeedPostRow }) {
  return (
    <div className="postbox">
      <div className="muted small">
        {PLACE_LABEL[post.place.type]}:{' '}
        <a href={appUrl(post.place.url)} target="_blank" rel="noreferrer">
          {post.place.title}
        </a>{' '}
        · <span className="handle">@{post.author.username}</span> · {formatDateTime(post.createdAt)}
      </div>
      <div>
        {post.kind === 'NOTICE' ? <Badge tone="info">Aviso</Badge> : null} {post.status === 'PENDING' ? <Badge tone="warn">Aguardando o dono</Badge> : null}{' '}
        {post.openReportsCount > 0 ? <Badge tone="bad">{post.openReportsCount} denúncia(s) aberta(s)</Badge> : null}
      </div>
      <div className="clip">{post.body ?? <span className="muted">Sem texto</span>}</div>
      <div className="muted small">
        {post.imageIds.length} foto(s) · {post.commentsCount} comentário(s)
      </div>
    </div>
  );
}

function Comments({ postId, onAction }: { postId: string; onAction: (a: ActionSpec) => void }) {
  const list = useAsync(() => api.feedComments(postId), [postId]);
  return (
    <Loadable state={list} empty="Sem comentários." isEmpty={(d) => d.items.length === 0}>
      {(data) => (
        <ul className="feedcomments">
          {data.items.map((c: FeedCommentRow) => (
            <li key={c.id}>
              <div>
                <span className="handle">@{c.author.username}</span> <span className="muted small">{formatDateTime(c.createdAt)}</span>{' '}
                {c.openReportsCount > 0 ? <Badge tone="bad">{c.openReportsCount} denúncia(s)</Badge> : null}
                <div className="pre">{c.body}</div>
              </div>
              <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => onAction({ ...deleteFeedCommentAction(c), run: async (n) => { await api.deleteFeedComment(c.id, n); list.reload(); } })}>
                Apagar
              </button>
            </li>
          ))}
        </ul>
      )}
    </Loadable>
  );
}

function FeedPostCard({ post, onAction }: { post: FeedPostRow; onAction: (a: ActionSpec) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="report">
      <FeedThumb post={post} />
      <div className="report__main">
        <FeedPostSummary post={post} />
        {post.commentsCount > 0 ? (
          <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Ver comentários</summary>
            {open ? <Comments postId={post.id} onAction={onAction} /> : null}
          </details>
        ) : null}
      </div>
      <div className="report__actions">
        <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => onAction(deleteFeedPostAction(post))}>
          Apagar publicação
        </button>
      </div>
    </article>
  );
}

export function FeedPage() {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const q = useDebounced(text.trim());
  const stats = useAsync(() => api.stats(), []);
  const list = useAsync(() => api.feedPosts({ q, offset, ...(filter === 'all' ? {} : { status: filter }) }), [q, filter, offset]);
  return (
    <>
      <PageHead title="Feed" hint="Publicações dos feeds de eventos e rolês. Quem organiza aprova as pendentes no app; aqui você confere e apaga.">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar texto ou @autor…" label="Buscar publicação" />
      </PageHead>
      <div className="toolbar">
        <Tabs
          value={filter}
          onChange={(f) => { setFilter(f); setOffset(0); }}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'pending', label: 'Aguardando aprovação', count: stats.data?.pendingFeedPosts },
            { value: 'published', label: 'Publicadas' },
          ]}
        />
      </div>
      <Loadable state={list} empty="Nenhuma publicação encontrada." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <div className="reports">{page.items.map((p) => <FeedPostCard key={p.id} post={p} onAction={setAction} />)}</div>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={() => { list.reload(); stats.reload(); }} /> : null}
    </>
  );
}
