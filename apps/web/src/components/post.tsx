import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CarouselIcon, CommentIcon, HeartIcon, MoreIcon, SendIcon } from './icons.tsx';
import { SoundToggle } from './sound-toggle.tsx';
import { hasSound } from '../lib/sound.ts';
import { AdjustSheet, CommentsSheet, EditPostSheet, PostMenuSheet, ReportSheet, SharePostSheet } from './post-actions.tsx';
import type { PostGone } from './post-actions.tsx';
import { VenueLogo } from './venue-logo.tsx';
import { PosterEvent } from './poster.tsx';
import { Avatar, Button, EmptyState, ErrorState, Loading } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { formatWhen } from '../lib/chat.ts';
import { feedRatio } from '../lib/crop.ts';
import { useDwell } from './dwell.tsx';
import type { DwellSource } from '../lib/dwell.ts';
import { timeAgo } from '../lib/format.ts';
import type { PostImage, PostView, PostsPage } from '../lib/types.ts';
import { Link } from '../router.tsx';

function Slide({ image, index, total, onFirstLoad }: { image: PostImage; index: number; total: number; onFirstLoad?: (w: number, h: number) => void }) {
  const [failed, setFailed] = useState(false);
  // O navegador só deixa o vídeo começar sozinho sem som; quem quiser o som toca no botão.
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleSound = () => {
    const next = !muted;
    if (videoRef.current) videoRef.current.muted = next;
    setMuted(next);
  };
  // Toca sozinho quando o vídeo aparece na tela (e é o item visível do carrossel) e pausa quando sai.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !image.videoPath) return;
    video.muted = muted;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { threshold: 0.6 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [image.videoPath]);
  return (
    <figure className="pcarousel__slide" aria-label={`${image.videoPath ? 'Vídeo' : 'Foto'} ${index + 1} de ${total}`}>
      {image.videoPath ? (
        <video
          ref={videoRef}
          src={api.assetUrl(image.videoPath)}
          poster={image.path ? api.assetUrl(image.path) : undefined}
          controls
          muted
          loop
          playsInline
          preload="auto"
          aria-label={`Vídeo ${index + 1} de ${total}`}
          onLoadedMetadata={(event) => {
            if (index === 0) onFirstLoad?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
          }}
        />
      ) : image.path && !failed ? (
        <img
          src={api.assetUrl(image.path)}
          alt=""
          loading={index === 0 ? 'lazy' : 'eager'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          onLoad={(event) => {
            if (index === 0) onFirstLoad?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
          }}
        />
      ) : (
        <span className="pcarousel__missing">Foto indisponível</span>
      )}
      {hasSound(image) ? <SoundToggle muted={muted} onToggle={toggleSound} shifted={total > 1} /> : null}
      {image.kind === 'PLACE' ? <figcaption>Foto: {image.photoAuthor ? `${image.photoAuthor} · ` : ''}Google</figcaption> : null}
    </figure>
  );
}

/** Fotos lado a lado, que se arrastam com o dedo; mostra "2/5" quando há mais de uma. */
export function Carousel({ images }: { images: PostImage[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [ratio, setRatio] = useState(4 / 5);
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
    <div className="pcarousel" style={{ '--carousel-ratio': String(ratio) } as CSSProperties}>
      <div className="pcarousel__track" ref={ref} onScroll={onScroll} role="group" aria-label="Fotos e vídeo do post" tabIndex={images.length > 1 ? 0 : undefined}>
        {images.map((image, i) => (
          <Slide key={image.id} image={image} index={i} total={images.length} onFirstLoad={(w, h) => setRatio(feedRatio(w, h))} />
        ))}
      </div>
      {images.length > 1 ? (
        <>
          <span className="pcarousel__count" aria-hidden="true">
            {index + 1}/{images.length}
          </span>
          <div className="pcarousel__dots">
            {images.map((image, i) => (
              <button key={image.id} type="button" className={`pcarousel__dot${i === index ? ' pcarousel__dot--on' : ''}`} onClick={() => go(i)} aria-label={`Ir para a foto ${i + 1}`} aria-current={i === index ? 'true' : undefined} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Evento publicado como post, em formato de cartaz: foto, nome, lugar, horário e "Eu vou". */
function EventPostCard({ post, event }: { post: PostView; event: NonNullable<PostView['event']> }) {
  const first = post.images[0];
  return (
    <PosterEvent
      eventId={post.id}
      title={event.title}
      startsAt={event.startsAt}
      whenText={formatWhen(event.startsAt, event.endsAt, new Date())}
      venue={post.placeName ?? 'Evento'}
      image={first?.path ? api.assetUrl(first.path) : null}
      fallback={<span className="poster__kind" aria-hidden="true">Evento</span>}
    />
  );
}

export function PostCard({ post: initial, onGone, asEvent, poster, track }: { post: PostView; onGone?: (id: string, why: PostGone) => void; asEvent?: boolean; poster?: boolean; track?: DwellSource }) {
  const dwellRef = useDwell<HTMLElement>('POST', initial.id, track ?? false);
  const [post, setPost] = useState(initial);
  const [sheet, setSheet] = useState<'menu' | 'edit' | 'adjust' | 'report' | 'comments' | 'share' | undefined>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [myTag, setMyTag] = useState(initial.myTag);
  const [tagBusy, setTagBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

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

  async function run(action: () => Promise<unknown>, why: PostGone) {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
      setSheet(undefined);
      onGone?.(post.id, why);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setSheet(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!post.archived) return run(() => api.archivePost(post.id), 'archived');
    setBusy(true);
    try {
      await api.unarchivePost(post.id);
      setPost({ ...post, archived: false });
      setSheet(undefined);
      onGone?.(post.id, 'archived');
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setSheet(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike() {
    if (likeBusy) return;
    const was = post.likedByMe;
    setPost({ ...post, likedByMe: !was, likeCount: Math.max(0, post.likeCount + (was ? -1 : 1)) });
    setLikeBusy(true);
    setProblem(undefined);
    try {
      const result = was ? await api.unlikePost(post.id) : await api.likePost(post.id);
      setPost((current) => ({ ...current, likedByMe: result.liked, likeCount: result.likeCount }));
    } catch (failure) {
      setPost((current) => ({ ...current, likedByMe: was, likeCount: Math.max(0, current.likeCount + (was ? 1 : -1)) }));
      setProblem(toApiError(failure).message);
    } finally {
      setLikeBusy(false);
    }
  }

  const eventCard = post.event && asEvent;
  const cartaz = poster === true && !eventCard;
  const hasVideo = post.images.some((i) => i.videoPath);
  return (
    <article className="post" ref={dwellRef}>
      {cartaz ? null : (
      <header className="post__head">
        {post.venue ? (
          <Link to={`/bares/${encodeURIComponent(post.venue.id)}`} className="post__author">
            <VenueLogo name={post.venue.name} logoUrl={post.venue.logoUrl} size={36} />
            <strong>{post.venue.name}</strong>
          </Link>
        ) : (
          <Link to={`/u/${encodeURIComponent(post.author.username)}`} className="post__author">
            <Avatar profile={post.author} size={36} />
            <strong>{post.author.username}</strong>
          </Link>
        )}
        <Link to={`/posts/${encodeURIComponent(post.id)}`} className="post__when">
          {timeAgo(post.createdAt, new Date())}
          {post.edited ? ' · editado' : ''}
        </Link>
        <button type="button" className="iconbtn post__more" onClick={() => setSheet('menu')} aria-label="Mais opções do post" aria-haspopup="dialog">
          <MoreIcon />
        </button>
      </header>
      )}
      {post.archived ? <p className="muted">Arquivado: só você vê este post.</p> : null}
      {problem ? <p className="field__error">{problem}</p> : null}
      {myTag === 'PENDING' ? (
        <div className="callout">
          <p className="callout__text">
            <strong>{post.author.username}</strong> marcou você neste post. Se aceitar, ele aparece no seu perfil e no seu feed.
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
      {post.event && eventCard ? <EventPostCard post={post} event={post.event} /> : null}
      {post.event && !eventCard ? (
        <p className="post__event">
          <span className="post__eventbadge">Evento</span> <strong>{post.event.title}</strong>
          <span className="muted"> · {eventWhen(post.event.startsAt)}</span>
        </p>
      ) : null}
      {cartaz ? (
        <div className={`poster poster--post${hasVideo ? ' poster--video' : ''}${post.images.length > 1 ? ' poster--multi' : ''}`}>
          <div className="poster__stage">
          <div className="poster__media">
            <Carousel key={post.images.map((i) => i.id).join()} images={post.images} />
          </div>
          <div className="poster__scrim poster__scrim--post" aria-hidden="true" />
          <div className="poster__top">
            <div className="poster__who">
              {post.venue ? (
                <Link to={`/bares/${encodeURIComponent(post.venue.id)}`} aria-label={`Página de ${post.venue.name}`} className="poster__avatar">
                  <VenueLogo name={post.venue.name} logoUrl={post.venue.logoUrl} size={32} />
                </Link>
              ) : (
                <Link to={`/u/${encodeURIComponent(post.author.username)}`} aria-label={`Perfil de ${post.author.username}`} className="poster__avatar">
                  <Avatar profile={post.author} size={32} />
                </Link>
              )}
              <span className="poster__whotext">
                {post.venue ? (
                  <Link to={`/bares/${encodeURIComponent(post.venue.id)}`} className="poster__name">{post.venue.name}</Link>
                ) : (
                  <Link to={`/u/${encodeURIComponent(post.author.username)}`} className="poster__name">{post.author.username}</Link>
                )}
                <Link to={`/posts/${encodeURIComponent(post.id)}`} className="poster__sub">
                  {post.placeName && !post.venue ? `${post.placeName} · ` : ''}
                  {timeAgo(post.createdAt, new Date())}
                  {post.edited ? ' · editado' : ''}
                </Link>
              </span>
            </div>
            <button type="button" className="poster__round" onClick={() => setSheet('menu')} aria-label="Mais opções do post" aria-haspopup="dialog">
              <MoreIcon />
            </button>
          </div>
          <div className="poster__bottom">
            {post.caption || post.tags.length > 0 ? (
              <div className="poster__caption">
                {post.caption ? (
                  <p className="poster__text">
                    <strong>{post.venue ? post.venue.name : post.author.username}</strong> {post.caption}
                  </p>
                ) : null}
                {post.tags.length > 0 ? (
                  <p className="poster__with">
                    Com{' '}
                    {post.tags.map((t, i) => (
                      <span key={t.user.userId}>
                        {i > 0 ? ', ' : ''}
                        <Link to={`/u/${encodeURIComponent(t.user.username)}`}>{t.user.username}</Link>
                        {t.status === 'PENDING' ? ' (aguardando)' : ''}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
          <div className="poster__foot">
            <div className="poster__row" role="group" aria-label="Ações do post">
      <div className="poster__glass poster__glass--actions">
          <button type="button" className={`poster__act${post.likedByMe ? ' poster__act--on' : ''}`} onClick={() => void toggleLike()} aria-pressed={post.likedByMe} aria-label={post.likedByMe ? 'Descurtir' : 'Curtir'}>
            <HeartIcon filled={post.likedByMe} />
            <span>{post.likeCount > 0 ? post.likeCount : ''}</span>
          </button>
          <button type="button" className="poster__act" onClick={() => setSheet('comments')} aria-label={post.commentCount > 0 ? `Comentários (${post.commentCount})` : 'Comentar'}>
            <CommentIcon />
            <span>{post.commentCount > 0 ? post.commentCount : ''}</span>
          </button>
        </div>
        <button type="button" className="poster__act poster__share" onClick={() => setSheet('share')} aria-label="Compartilhar">
          <SendIcon />
        </button>
      </div>
          </div>
        </div>
      ) : null}
      {eventCard || cartaz ? null : <Carousel key={post.images.map((i) => i.id).join()} images={post.images} />}
      {cartaz ? null : (
      <div className="post__actions" role="group" aria-label="Ações do post">
        <button type="button" className={`post__action${post.likedByMe ? ' post__action--on' : ''}`} onClick={() => void toggleLike()} aria-pressed={post.likedByMe} aria-label={post.likedByMe ? 'Descurtir' : 'Curtir'}>
          <HeartIcon filled={post.likedByMe} />
          <span>{post.likeCount > 0 ? post.likeCount : ''}</span>
        </button>
        <button type="button" className="post__action" onClick={() => setSheet('comments')} aria-label={post.commentCount > 0 ? `Comentários (${post.commentCount})` : 'Comentar'}>
          <CommentIcon />
          <span>{post.commentCount > 0 ? post.commentCount : ''}</span>
        </button>
        <button type="button" className="post__action" onClick={() => setSheet('share')} aria-label="Compartilhar">
          <SendIcon />
        </button>
      </div>
      )}
      {post.placeName && !eventCard && !cartaz ? (
        <p className="post__place">
          <strong>{post.placeName}</strong>
          {post.placeAddress ? <span> · {post.placeAddress}</span> : null}
        </p>
      ) : null}
      {post.tags.length > 0 && !cartaz ? (
        <p className="post__tags">
          Com{' '}
          {post.tags.map((t, i) => (
            <span key={t.user.userId}>
              {i > 0 ? ', ' : ''}
              <Link to={`/u/${encodeURIComponent(t.user.username)}`}>{t.user.username}</Link>
              {t.status === 'PENDING' ? <span className="muted"> (aguardando)</span> : null}
            </span>
          ))}
        </p>
      ) : null}
      {post.caption && !cartaz ? <p className="post__caption">{post.caption}</p> : null}

      {sheet === 'menu' ? (
        <PostMenuSheet
          post={post}
          busy={busy}
          onClose={() => setSheet(undefined)}
          onEdit={() => setSheet('edit')}
          onAdjust={() => setSheet('adjust')}
          onReport={() => setSheet('report')}
          onArchiveToggle={() => void toggleArchive()}
          onNotInterested={() => void run(() => api.notInterested(post.id), 'hidden')}
          onDelete={() => void run(() => api.deletePost(post.id), 'deleted')}
        />
      ) : null}
      {sheet === 'edit' ? (
        <EditPostSheet
          post={post}
          onClose={() => setSheet(undefined)}
          onSaved={(updated) => {
            setPost(updated);
            setSheet(undefined);
          }}
        />
      ) : null}
      {sheet === 'adjust' ? (
        <AdjustSheet
          post={post}
          onClose={() => setSheet(undefined)}
          onSaved={(updated) => {
            setPost(updated);
            setSheet(undefined);
          }}
        />
      ) : null}
      {sheet === 'report' ? <ReportSheet postId={post.id} onClose={() => setSheet(undefined)} onDone={() => { setSheet(undefined); onGone?.(post.id, 'hidden'); }} /> : null}
      {sheet === 'comments' ? <CommentsSheet postId={post.id} onClose={() => setSheet(undefined)} onCountChange={(delta) => setPost((current) => ({ ...current, commentCount: Math.max(0, current.commentCount + delta) }))} /> : null}
      {sheet === 'share' ? <SharePostSheet post={post} onClose={() => setSheet(undefined)} /> : null}
    </article>
  );
}

/** Lista de posts com "Carregar mais". `load` busca uma página a partir de um deslocamento. */
/** `inject`: bloco que entra depois de `after` posts (ou no fim, se houver menos). */
export function PostList({ load, emptyTitle, emptyHint, reloadKey, inject }: { load: (offset: number) => Promise<PostsPage>; emptyTitle: string; emptyHint?: string; reloadKey?: string; inject?: { after: number; node: ReactNode } | { after: number; node: ReactNode }[] }) {
  const [page, setPage] = useState<PostsPage | undefined>();
  const [items, setItems] = useState<PostView[]>([]);
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const injected = inject === undefined ? [] : Array.isArray(inject) ? inject : [inject];
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
  // Rolar até perto do fim carrega a próxima página sozinho. Depois de um erro, só o "Tentar de novo" continua.
  const hasMore = page?.hasMore === true;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading || error || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void more(items.length);
      },
      { rootMargin: '400px 0px' },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, error, items.length]);
  if (error && items.length === 0) return <ErrorState message={error.message} onRetry={() => void more(0)} />;
  if (!page) return <Loading />;
  if (items.length === 0) {
    return (
      <>
        <EmptyState title={emptyTitle}>{emptyHint}</EmptyState>
        {injected.map((i) => (<Fragment key={i.after}>{i.node}</Fragment>))}
      </>
    );
  }
  return (
    <div className="postlist">
      {items.map((post, index) => (
        <Fragment key={post.id}>
          <PostCard post={post} asEvent poster track="FEED" onGone={(id) => setItems((current) => current.filter((p) => p.id !== id))} />
          {injected.filter((i) => index === Math.min(i.after, items.length) - 1).map((i) => (<Fragment key={i.after}>{i.node}</Fragment>))}
        </Fragment>
      ))}
      {error ? <ErrorState message={error.message} onRetry={() => void more(items.length)} /> : null}
      {page.hasMore ? (
        <div className="more" ref={sentinel}>
          {loading ? <Loading /> : typeof IntersectionObserver === 'undefined' ? <Button variant="secondary" onClick={() => void more(items.length)}>Carregar mais</Button> : null}
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
