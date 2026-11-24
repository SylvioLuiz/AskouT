import { useState } from 'react';
import { api, postImageUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { EVENT_KIND_LABEL, FEED_POLICY_LABEL, formatDateTime } from '../labels.ts';
import type { PostDetail as PostDetailData, PostRow } from '../types.ts';
import { LinkedList, Mono, PersonLink, RecordLink, RecordModal, RecordView, YesNo, useOpenRecord, useReloadOnChange } from '../record.tsx';
import type { RecordSection } from '../record.tsx';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';

export function PostThumb({ post }: { post: PostRow }) {
  return post.firstImageId ? <img className="thumb" src={postImageUrl(post.firstImageId)} alt="" loading="lazy" /> : <div className="thumb thumb--empty" aria-hidden="true" />;
}

/** Um post inteiro: texto, lugar, dados de evento, fotos, marcações, números e os últimos comentários. Só leitura (a gestão apaga). */
export function PostDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAsync(() => api.post(id), [id]);
  return (
    <RecordModal state={detail} label="Post" onClose={onClose}>
      {(p) => <PostRecord p={p} onClose={onClose} />}
    </RecordModal>
  );
}

function PostRecord({ p, onClose }: { p: PostDetailData; onClose: () => void }) {
  const isEvent = p.eventTitle !== null;
  const sections: RecordSection[] = [
    {
      title: 'Post',
      fields: [
        { label: 'Autor', value: <PersonLink id={p.author.id} username={p.author.username} displayName={p.author.displayName} /> },
        { label: 'Legenda', value: p.caption ? <span className="pre">{p.caption}</span> : null, wide: true },
        { label: 'Lugar', value: p.placeName },
        { label: 'Endereço do lugar', value: p.placeAddress },
        { label: 'Rolê do AskouT', value: p.placeVenue ? <RecordLink kind="venue" id={p.placeVenue.id}>{p.placeVenue.name}</RecordLink> : null },
        { label: 'Em nome do local', value: p.venue ? <RecordLink kind="venue" id={p.venue.id}>{p.venue.name}</RecordLink> : null },
        { label: 'Evento vinculado', value: p.linkedEventId ? <Mono>{p.linkedEventId}</Mono> : null },
        { label: 'Publicado em', value: formatDateTime(p.createdAt) },
        { label: 'Editado em', value: p.editedAt ? formatDateTime(p.editedAt) : null },
        { label: 'Arquivado em', value: p.archivedAt ? formatDateTime(p.archivedAt) : null },
        { label: 'ID', value: <Mono>{p.id}</Mono> },
      ],
    },
    {
      title: 'Evento',
      hidden: !isEvent,
      fields: [
        { label: 'Nome', value: <strong>{p.eventTitle}</strong> },
        { label: 'Tipo', value: EVENT_KIND_LABEL[p.eventKind] ?? p.eventKind },
        { label: 'Início', value: formatDateTime(p.eventStartsAt) },
        { label: 'Fim', value: formatDateTime(p.eventEndsAt) },
        { label: 'Privado', value: <YesNo value={p.eventPrivate} /> },
        { label: 'Quem publica no feed', value: FEED_POLICY_LABEL[p.feedPolicy] },
      ],
    },
    {
      title: 'Números',
      fields: [
        { label: 'Curtidas', value: p.counts.likes },
        { label: 'Comentários', value: p.counts.comments },
        { label: 'Denúncias', value: p.counts.reports > 0 ? <strong className="alert">{p.counts.reports}</strong> : 0 },
        { label: 'Confirmados', value: p.counts.attendees, hidden: !isEvent },
        { label: 'Convidados', value: p.counts.invites, hidden: !isEvent },
        { label: 'Stories', value: p.counts.stories },
        { label: 'Publicações no feed', value: p.counts.feedPosts, hidden: !isEvent },
        { label: 'Repostagens', value: p.counts.reposts },
      ],
    },
    {
      title: 'Fotos',
      count: p.images.length,
      children:
        p.images.length === 0 ? (
          <p className="muted small">Sem fotos.</p>
        ) : (
          <div className="record__photos">
            {p.images.map((img) =>
              img.uploaded ? <img key={img.id} className="thumb" src={postImageUrl(img.id)} alt="" loading="lazy" /> : <span key={img.id} className="muted small">Foto do lugar (Google)</span>,
            )}
          </div>
        ),
    },
    {
      title: 'Marcados',
      count: p.tagged.length,
      hidden: p.tagged.length === 0,
      children: <LinkedList items={p.tagged} empty="" keyOf={(t) => t.id} render={(t) => ({ main: <PersonLink id={t.id} username={t.username} displayName={t.displayName} />, side: formatDateTime(t.at) })} />,
    },
    {
      title: 'Quem vai',
      count: p.counts.attendees,
      hidden: !isEvent,
      children: (
        <LinkedList
          items={p.going}
          total={p.counts.attendees}
          empty="Ninguém confirmou ainda."
          keyOf={(g) => g.id}
          render={(g) => ({ main: <PersonLink id={g.id} username={g.username} displayName={g.displayName} avatarUrl={g.avatarUrl} />, side: `Confirmou ${formatDateTime(g.at)}` })}
        />
      ),
    },
    {
      title: 'Convidados que ainda não confirmaram',
      count: p.invitedPendingCount,
      hidden: !isEvent || p.invitedPendingCount === 0,
      children: (
        <LinkedList
          items={p.invitedPending}
          total={p.invitedPendingCount}
          empty=""
          keyOf={(i) => i.id}
          render={(i) => ({
            main: <PersonLink id={i.id} username={i.username} displayName={i.displayName} avatarUrl={i.avatarUrl} />,
            side: `${i.invitedBy ? `Convite de @${i.invitedBy.username} · ` : ''}${formatDateTime(i.at)}`,
          })}
        />
      ),
    },
    {
      title: 'Últimos comentários',
      count: p.counts.comments,
      children: (
        <LinkedList
          items={p.recentComments}
          total={p.counts.comments}
          empty="Nenhum comentário."
          keyOf={(c) => c.id}
          render={(c) => ({
            main: (
              <>
                <span className="handle">@{c.username}</span> {c.body || <span className="muted">(GIF)</span>}
              </>
            ),
            side: formatDateTime(c.createdAt),
          })}
        />
      ),
    },
  ];
  return (
    <RecordView
      title={isEvent ? (p.eventTitle ?? 'Evento') : `Post de @${p.author.username}`}
      subtitle={formatDateTime(p.createdAt)}
      status={
        <>
          {isEvent ? <Badge tone="info">Evento</Badge> : <Badge>Post</Badge>} {p.eventPrivate ? <Badge>Privado</Badge> : null} {p.archivedAt ? <Badge tone="warn">Arquivado</Badge> : null}{' '}
          {p.counts.reports > 0 ? <Badge tone="bad">{p.counts.reports} denúncia(s)</Badge> : null}
        </>
      }
      sections={sections}
      actions={[{ label: 'Apagar', danger: true, confirm: deletePostAction({ id: p.id, author: { username: p.author.username } }) }]}
      onClose={onClose}
      onChanged={onClose}
    />
  );
}

export function deletePostAction(post: Pick<PostRow, 'id'> & { author: { username: string } }): ActionSpec {
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
  useReloadOnChange(list.reload);
  const openRecord = useOpenRecord();
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
                      <div className="clip">
                        <button type="button" className="linkbtn" onClick={() => openRecord({ kind: 'post', id: p.id })} aria-label="Ver detalhes do post">
                          {p.caption ?? <span className="muted">Sem legenda</span>}
                        </button>
                      </div>
                      <div className="muted small">{p.imagesCount} foto(s){p.archived ? ' · arquivado' : ''}</div>
                    </td>
                    <td>
                      <PersonLink id={p.author.id} username={p.author.username} />
                    </td>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td className="num">{p.reportsCount > 0 ? <strong className="alert">{p.reportsCount}</strong> : 0}</td>
                    <td className="right">
                      <button type="button" className="btn btn--small" onClick={() => openRecord({ kind: 'post', id: p.id })}>
                        Detalhes
                      </button>{' '}
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
