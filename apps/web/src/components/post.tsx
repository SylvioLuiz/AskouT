import { useEffect, useRef, useState } from 'react';
import { CarouselIcon } from './icons.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Loading } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import type { PostImage, PostView, PostsPage } from '../lib/types.ts';
import { Link } from '../router.tsx';

function Slide({ image, index, total }: { image: PostImage; index: number; total: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="carousel__slide" aria-label={`Foto ${index + 1} de ${total}`}>
      {image.path && !failed ? (
        <img src={api.assetUrl(image.path)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className="carousel__missing">Foto indisponível</span>
      )}
      {image.kind === 'PLACE' ? <figcaption>Foto: {image.photoAuthor ? `${image.photoAuthor} · ` : ''}Google</figcaption> : null}
    </figure>
  );
}

/** Fotos lado a lado, que se arrastam com o dedo; mostra "2/5" quando há mais de uma. */
export function Carousel({ images }: { images: PostImage[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  function onScroll() {
    const el = ref.current;
    if (!el || el.clientWidth === 0) return;
    setIndex(Math.min(images.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  }
  function go(to: number) {
    const el = ref.current;
    if (el) el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
  }
  return (
    <div className="carousel">
      <div className="carousel__track" ref={ref} onScroll={onScroll} role="group" aria-label="Fotos do post" tabIndex={images.length > 1 ? 0 : undefined}>
        {images.map((image, i) => (
          <Slide key={image.id} image={image} index={i} total={images.length} />
        ))}
      </div>
      {images.length > 1 ? (
        <>
          <span className="carousel__count" aria-hidden="true">
            {index + 1}/{images.length}
          </span>
          <div className="carousel__dots">
            {images.map((image, i) => (
              <button key={image.id} type="button" className={`carousel__dot${i === index ? ' carousel__dot--on' : ''}`} onClick={() => go(i)} aria-label={`Ir para a foto ${i + 1}`} aria-current={i === index ? 'true' : undefined} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function PostCard({ post, onDeleted }: { post: PostView; onDeleted?: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [myTag, setMyTag] = useState(post.myTag);
  const [tagBusy, setTagBusy] = useState(false);
  async function answerTag(action: 'accept' | 'decline') {
    setTagBusy(true);
    setProblem(undefined);
    try {
      const result = await api.respondTag(post.id, action);
      setMyTag(result.status);
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setTagBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setProblem(undefined);
    try {
      await api.deletePost(post.id);
      onDeleted?.(post.id);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }
  return (
    <article className="post">
      <header className="post__head">
        <Link to={`/u/${encodeURIComponent(post.author.username)}`} className="post__author">
          <Avatar profile={post.author} size={36} />
          <strong>{post.author.displayName}</strong>
        </Link>
        <Link to={`/posts/${encodeURIComponent(post.id)}`} className="post__when">
          {timeAgo(post.createdAt, new Date())}
        </Link>
        {post.mine ? (
          <Button variant="quiet" small onClick={() => setConfirming(!confirming)} aria-expanded={confirming}>
            Apagar
          </Button>
        ) : null}
      </header>
      {confirming ? <Confirm danger question="Apagar este post? As fotos e a legenda são removidas." confirmLabel="Apagar" busy={busy} onCancel={() => setConfirming(false)} onConfirm={remove} /> : null}
      {problem ? <p className="field__error">{problem}</p> : null}
      {myTag === 'PENDING' ? (
        <div className="callout">
          <p className="callout__text">
            <strong>{post.author.displayName}</strong> marcou você neste post. Se aceitar, ele aparece no seu perfil e no seu feed.
          </p>
          <div className="row-actions">
            <Button small loading={tagBusy} onClick={() => void answerTag('accept')}>
              Aceitar
            </Button>
            <Button small variant="secondary" disabled={tagBusy} onClick={() => void answerTag('decline')}>
              Recusar
            </Button>
          </div>
        </div>
      ) : null}
      {myTag === 'ACCEPTED' && !post.mine ? (
        <p className="muted">
          Você está marcado neste post.{' '}
          <button type="button" className="linkbtn" onClick={() => void answerTag('decline')} disabled={tagBusy}>
            Tirar minha marcação
          </button>
        </p>
      ) : null}
      {post.event ? (
        <p className="post__event">
          <span className="post__eventbadge">Evento</span> <strong>{post.event.title}</strong>
          <span className="muted"> · {eventWhen(post.event.startsAt)}</span>
        </p>
      ) : null}
      <Carousel images={post.images} />
      {post.placeName ? (
        <p className="post__place">
          <strong>{post.placeName}</strong>
          {post.placeAddress ? <span> · {post.placeAddress}</span> : null}
        </p>
      ) : null}
      {post.tags.length > 0 ? (
        <p className="post__tags">
          Com{' '}
          {post.tags.map((t, i) => (
            <span key={t.user.userId}>
              {i > 0 ? ', ' : ''}
              <Link to={`/u/${encodeURIComponent(t.user.username)}`}>@{t.user.username}</Link>
              {t.status === 'PENDING' ? <span className="muted"> (aguardando)</span> : null}
            </span>
          ))}
        </p>
      ) : null}
      {post.caption ? <p className="post__caption">{post.caption}</p> : null}
    </article>
  );
}

/** Lista de posts com "Carregar mais". `load` busca uma página a partir de um deslocamento. */
export function PostList({ load, emptyTitle, emptyHint, reloadKey }: { load: (offset: number) => Promise<PostsPage>; emptyTitle: string; emptyHint?: string; reloadKey?: string }) {
  const [page, setPage] = useState<PostsPage | undefined>();
  const [items, setItems] = useState<PostView[]>([]);
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);
  async function more(offset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const next = await load(offset);
      setPage(next);
      setItems((current) => (offset === 0 ? next.items : [...current, ...next.items]));
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setPage(undefined);
    setItems([]);
    void more(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  if (error && items.length === 0) return <ErrorState message={error.message} onRetry={() => void more(0)} />;
  if (!page) return <Loading />;
  if (items.length === 0) return <EmptyState title={emptyTitle}>{emptyHint}</EmptyState>;
  return (
    <div className="postlist">
      {items.map((post) => (
        <PostCard key={post.id} post={post} onDeleted={(id) => setItems((current) => current.filter((p) => p.id !== id))} />
      ))}
      {error ? <ErrorState message={error.message} onRetry={() => void more(items.length)} /> : null}
      {page.hasMore ? (
        <div className="more">
          <Button variant="secondary" loading={loading} onClick={() => void more(items.length)}>
            Carregar mais
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Grade de quadrados do perfil: toque abre o post. */
const eventFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
function eventWhen(iso: string): string {
  return eventFmt.format(new Date(iso));
}

/** Grade de posts de uma pessoa. `kind` separa eventos de posts comuns; `quiet` não mostra o aviso de lista vazia. */
export function PostGrid({ username, kind, quiet, onCount }: { username: string; kind?: 'event' | 'post'; quiet?: boolean; onCount?: (total: number) => void }) {
  const [page, setPage] = useState<PostsPage | undefined>();
  const [items, setItems] = useState<PostView[]>([]);
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);
  async function more(offset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.userPosts(username, { limit: 18, offset }, kind);
      setPage(next);
      if (next.total !== null) onCount?.(next.total);
      setItems((current) => (offset === 0 ? next.items : [...current, ...next.items]));
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setPage(undefined);
    setItems([]);
    void more(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, kind]);
  if (error && items.length === 0) return <ErrorState message={error.message} onRetry={() => void more(0)} />;
  if (!page) return <Loading />;
  if (items.length === 0) return quiet ? null : <EmptyState title="Nenhum post ainda">Posts com fotos aparecem aqui.</EmptyState>;
  return (
    <>
      <ul className="postgrid" aria-label="Posts">
        {items.map((post) => {
          const first = post.images[0];
          return (
            <li key={post.id}>
              <Link to={`/posts/${encodeURIComponent(post.id)}`} className="postgrid__item" aria-label={post.caption ? `Post: ${post.caption}` : 'Abrir post'}>
                {first?.path ? <img src={api.assetUrl(first.path)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="postgrid__none" />}
                {post.event ? <span className="postgrid__event">Evento</span> : null}
                {post.images.length > 1 ? (
                  <span className="postgrid__multi" aria-label={`${post.images.length} fotos`}>
                    <CarouselIcon />
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {page.hasMore ? (
        <div className="more">
          <Button variant="secondary" loading={loading} onClick={() => void more(items.length)}>
            Carregar mais
          </Button>
        </div>
      ) : null}
    </>
  );
}
