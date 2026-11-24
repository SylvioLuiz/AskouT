import { useState } from 'react';
import { api, postImageUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { formatDateTime } from '../labels.ts';
import type { PostRow } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';

export function PostThumb({ post }: { post: PostRow }) {
  return post.firstImageId ? <img className="thumb" src={postImageUrl(post.firstImageId)} alt="" loading="lazy" /> : <div className="thumb thumb--empty" aria-hidden="true" />;
}

export function deletePostAction(post: PostRow): ActionSpec {
  return {
    title: 'Apagar post',
    description: <p>O post de @{post.author.username} some do feed, do perfil e das denúncias. Isso não pode ser desfeito.</p>,
    confirmLabel: 'Apagar post',
    danger: true,
    noteLabel: 'Motivo',
    noteRequired: true,
    run: (note) => api.deletePost(post.id, note),
  };
}

type PostSort = 'caption' | 'author' | 'createdAt' | 'reports';

export function PostsPage() {
  const [text, setText] = useState('');
  const [onlyEvents, setOnlyEvents] = useState(false);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<PostSort>();
  const onSort = (column: PostSort, first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.posts({ q, events: onlyEvents, offset, sort }), [q, onlyEvents, offset, sort]);
  return (
    <>
      <PageHead title="Posts" hint="Posts e eventos criados por pessoas. Busque por legenda, evento, rolê ou @autor.">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar post…" label="Buscar post" />
        <label className="check">
          <input type="checkbox" checked={onlyEvents} onChange={(e) => { setOnlyEvents(e.target.checked); setOffset(0); }} /> Só eventos
        </label>
      </PageHead>
      <Loadable state={list} empty="Nenhum post encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th aria-label="Foto" />
                  <SortTh label="Post" column="caption" sort={sort} onSort={onSort} />
                  <SortTh label="Autor" column="author" sort={sort} onSort={onSort} />
                  <SortTh label="Publicado" column="createdAt" sort={sort} onSort={onSort} first="desc" />
                  <SortTh label="Denúncias" column="reports" sort={sort} onSort={onSort} first="desc" className="num" />
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((p) => (
                  <tr key={p.id}>
                    <td className="thumbcell">
                      <PostThumb post={p} />
                    </td>
                    <td>
                      {p.eventTitle ? (
                        <>
                          <Badge tone="info">Evento</Badge> <strong>{p.eventTitle}</strong>
                          <div className="muted small">Começa em {formatDateTime(p.eventStartsAt)}</div>
                        </>
                      ) : null}
                      <div className="clip">{p.caption ?? <span className="muted">Sem legenda</span>}</div>
                      <div className="muted small">{p.imagesCount} foto(s){p.archived ? ' · arquivado' : ''}</div>
                    </td>
                    <td>
                      <span className="handle">@{p.author.username}</span>
                    </td>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td className="num">{p.reportsCount > 0 ? <strong className="alert">{p.reportsCount}</strong> : 0}</td>
                    <td className="right">
                      <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => setAction(deletePostAction(p))}>
                        Apagar
                      </button>
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
    </>
  );
}
