import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { CommentGifView, CommentTools } from './comment-tools.tsx';
import { Carousel } from './post.tsx';
import { PhotoViewer } from './photo-viewer.tsx';
import { ArrowUpIcon, CommentIcon, MoreIcon, PhotoIcon, TrashIcon, XIcon } from './icons.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { VenueLogo } from './venue-logo.tsx';
import { Avatar, Button, Confirm, ErrorState, Field, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import type { FeedWhere } from '../lib/api.ts';
import { useAuthContext } from '../auth.tsx';
import { useDebounced } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { FEED_BODY_MAX, FEED_COMMENT_MAX, FEED_IMAGES_MAX, FEED_POLICIES, FEED_REACTIONS, appendPage, applyReaction, commentCountLabel, policyLabel, reactionSummary } from '../lib/feed.ts';
import { timeAgo } from '../lib/format.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { applyMention, mentionQueryAt, splitMentions } from '../lib/mentions.ts';
import type { CommentGif, FeedComment, FeedPolicy, FeedPost, FeedReactions, FeedSettings, PostImage, PublicProfile } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

const PAGE = 10;

/** Texto com @menções que existem virando link para o perfil. */
function RichText({ body, mentions, className }: { body: string; mentions: string[]; className?: string }) {
  return (
    <p className={className}>
      {splitMentions(body, mentions).map((part, index) =>
        part.mention ? (
          <Link key={index} to={`/u/${encodeURIComponent(part.mention)}`} className="comment__mention">
            {part.text}
          </Link>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

/** Pessoas para completar a @menção que está sendo digitada. */
function useMentionPeople(text: string): { query: string | undefined; people: PublicProfile[] } {
  const query = mentionQueryAt(text);
  const debounced = useDebounced(query, 250);
  const [people, setPeople] = useState<PublicProfile[]>([]);
  useEffect(() => {
    if (debounced === undefined || debounced.length === 0) {
      setPeople([]);
      return;
    }
    let live = true;
    api.searchProfiles(debounced, 5).then((found) => live && setPeople(found)).catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [debounced]);
  return { query, people: query !== undefined && query.length > 0 ? people : [] };
}

function MentionList({ people, onPick }: { people: PublicProfile[]; onPick: (username: string) => void }) {
  if (people.length === 0) return null;
  return (
    <ul className="mentionlist" aria-label={t('Pessoas para marcar')}>
      {people.map((person) => (
        <li key={person.userId}>
          <button type="button" className="mentionlist__item" onClick={() => onPick(person.username)}>
            <Avatar profile={person} size={28} />
            <span>
              <strong>{person.username}</strong>
              {person.displayName ? <span className="muted"> {person.displayName}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Botão de reagir: abre a fileira de emojis; tocar no emoji que já é o seu tira a reação. */
function ReactButton({ reactions, onReact, small }: { reactions: FeedReactions; onReact: (emoji: string | null) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const mine = reactions.mine;
  return (
    <div className={`react${small ? ' react--small' : ''}`} ref={wrap}>
      <button type="button" className={`react__btn${mine ? ' react__btn--on' : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} aria-label={mine ? t('Sua reação: {emoji}. Trocar ou tirar', { emoji: mine }) : t('Reagir')}>
        <span aria-hidden="true">{mine ?? '🤍'}</span>
        {small ? null : <span>{mine ? t('Reagiu') : t('Reagir')}</span>}
      </button>
      {open ? (
        <div className="react__pick" role="group" aria-label={t('Escolha uma reação')}>
          {FEED_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`react__emoji${mine === emoji ? ' react__emoji--on' : ''}`}
              aria-pressed={mine === emoji}
              aria-label={mine === emoji ? t('Tirar a reação {emoji}', { emoji }) : t('Reagir com {emoji}', { emoji })}
              onClick={() => {
                setOpen(false);
                onReact(mine === emoji ? null : emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReactionSummary({ reactions }: { reactions: FeedReactions }) {
  const { total, top } = reactionSummary(reactions);
  if (total === 0) return null;
  return (
    <span className="feedpost__reacts" aria-label={t('{count} reações', { count: total })}>
      <span aria-hidden="true">{top.join('')}</span> {total}
    </span>
  );
}

// ---------- Publicação ----------

function asImages(post: FeedPost): PostImage[] {
  return post.images.map((i) => ({ id: i.id, kind: 'UPLOAD', path: i.path, photoAuthor: null }));
}

function FeedPostCard({ post, onChange, onGone, onComments, onApprove, onReject }: { post: FeedPost; onChange: (post: FeedPost) => void; onGone: (id: string) => void; onComments: () => void; onApprove?: () => void; onReject?: () => void }) {
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [viewing, setViewing] = useState<number | undefined>();
  const images = asImages(post);

  async function react(emoji: string | null) {
    const before = post.reactions;
    onChange({ ...post, reactions: applyReaction(before, emoji) });
    try {
      onChange({ ...post, reactions: await api.reactFeedPost(post.id, emoji) });
    } catch (failure) {
      onChange({ ...post, reactions: before });
      setProblem(toApiError(failure).message);
    }
  }

  async function remove() {
    setBusy(true);
    setProblem(undefined);
    try {
      await api.deleteFeedPost(post.id);
      onGone(post.id);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
      setConfirming(false);
    }
  }

  const published = post.status === 'PUBLISHED';
  return (
    <article className={`feedpost${post.kind === 'NOTICE' ? ' feedpost--notice' : ''}${published ? '' : ' feedpost--pending'}`} aria-label={post.kind === 'NOTICE' ? t('Aviso') : t('Publicação')}>
      <header className="post__head feedpost__head">
        {post.venue ? (
          <Link to={`/bares/${encodeURIComponent(post.venue.id)}`} className="post__author">
            <VenueLogo name={post.venue.name} logoUrl={post.venue.logoUrl} size={40} />
            <span className="feedpost__who">
              <strong>{post.venue.name}</strong>
              <span className="feedpost__when">{timeAgo(post.createdAt, new Date())}</span>
            </span>
          </Link>
        ) : (
          <Link to={`/u/${encodeURIComponent(post.author.username)}`} className="post__author">
            <Avatar profile={post.author} size={40} />
            <span className="feedpost__who">
              <strong>{post.author.username}</strong>
              <span className="feedpost__when">{timeAgo(post.createdAt, new Date())}</span>
            </span>
          </Link>
        )}
        {post.kind === 'NOTICE' ? <span className="feedpost__badge">{t('Aviso')}</span> : null}
        {!published ? <span className="feedpost__badge feedpost__badge--wait">{t('Aguardando aprovação')}</span> : null}
        {post.canDelete || post.canReport ? (
          <button type="button" className="iconbtn post__more" onClick={() => setMenu(true)} aria-label={t('Mais opções da publicação')} aria-haspopup="dialog">
            <MoreIcon />
          </button>
        ) : null}
      </header>
      {post.body ? <RichText body={post.body} mentions={post.mentions} className="feedpost__text" /> : null}
      {images.length > 0 ? <Carousel key={images.map((i) => i.id).join()} images={images} onOpen={(i) => setViewing(i)} /> : null}
      {viewing !== undefined ? <PhotoViewer images={images} start={viewing} onClose={() => setViewing(undefined)} /> : null}
      {problem ? <p className="field__error">{problem}</p> : null}
      {published ? (
        <>
          {post.reactions.counts.length > 0 || post.commentCount > 0 ? (
            <div className="feedpost__stats">
              <ReactionSummary reactions={post.reactions} />
              {post.commentCount > 0 ? (
                <button type="button" className="linkbtn feedpost__ccount" onClick={onComments}>
                  {commentCountLabel(post.commentCount)}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="feedpost__actions" role="group" aria-label={t('Ações da publicação')}>
            <ReactButton reactions={post.reactions} onReact={(emoji) => void react(emoji)} />
            <button type="button" className="react__btn" onClick={onComments}>
              <CommentIcon />
              <span>{t('Comentar')}</span>
            </button>
          </div>
        </>
      ) : post.canModerate && onApprove && onReject ? (
        <div className="row-actions">
          <Button small onClick={onApprove}>
            {t('Aprovar')}
          </Button>
          <Button small variant="secondary" onClick={onReject}>
            {t('Recusar')}
          </Button>
        </div>
      ) : (
        <p className="muted feedpost__waitnote">{t('Só você e quem organiza veem. Ela aparece no feed quando for aprovada.')}</p>
      )}
      {menu ? (
        <Sheet title={t('Opções da publicação')} onClose={() => { setMenu(false); setConfirming(false); }}>
          {confirming ? (
            <Confirm danger question={t('Apagar esta publicação? As fotos, reações e comentários saem junto.')} confirmLabel={t('Apagar')} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void remove()} />
          ) : (
            <ul className="sharelist">
              {post.canDelete ? (
                <li>
                  <button type="button" className="sharelist__item sharelist__item--danger" onClick={() => setConfirming(true)}>
                    <strong>{t('Apagar')}</strong>
                    <span>{post.mine ? t('Tira a sua publicação do feed.') : t('Como quem organiza, você pode tirar esta publicação do feed.')}</span>
                  </button>
                </li>
              ) : null}
              {post.canReport ? (
                <li>
                  <button type="button" className="sharelist__item sharelist__item--danger" onClick={() => { setMenu(false); setReporting(true); }}>
                    <strong>{t('Denunciar')}</strong>
                    <span>{t('Conteúdo que não deveria estar aqui.')}</span>
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </Sheet>
      ) : null}
      {reporting ? (
        <ReasonSheet
          title={t('Denunciar publicação')}
          doneText={t('Obrigado por avisar. A equipe vai analisar, e você não verá mais esta publicação.')}
          submit={(reason, details) => api.reportFeedPost(post.id, reason, details)}
          onClose={() => setReporting(false)}
          onDone={() => {
            setReporting(false);
            onGone(post.id);
          }}
        />
      ) : null}
    </article>
  );
}

// ---------- Publicar ----------

function ComposeSheet({ where, targetId, settings, onClose, onCreated }: { where: FeedWhere; targetId: string; settings: FeedSettings; onClose: () => void; onCreated: (post: FeedPost) => void }) {
  const [kind, setKind] = useState<'POST' | 'NOTICE'>('POST');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);
  const { people } = useMentionPeople(body);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, FEED_IMAGES_MAX - photos.length);
    event.target.value = '';
    if (files.length === 0) return;
    setReading(true);
    setMessage(undefined);
    try {
      const done: string[] = [];
      for (const file of files) done.push(await resizePostPhoto(file));
      setPhotos((current) => [...current, ...done].slice(0, FEED_IMAGES_MAX));
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : t('Não foi possível usar essa foto.'));
    } finally {
      setReading(false);
    }
  }

  async function publish() {
    setBusy(true);
    setMessage(undefined);
    try {
      onCreated(await api.createFeedPost(where, targetId, { kind, ...(body.trim() ? { body: body.trim() } : {}), ...(photos.length > 0 ? { images: photos } : {}) }));
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  const length = Array.from(body).length;
  const empty = kind === 'NOTICE' ? body.trim() === '' : body.trim() === '' && photos.length === 0;
  return (
    <Sheet title={t('Nova publicação')} onClose={onClose}>
      <div className="segmented" role="group" aria-label={t('Tipo de publicação')}>
        <button type="button" className={`segmented__tab${kind === 'POST' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'POST'} onClick={() => setKind('POST')}>
          {t('Fotos do rolê')}
        </button>
        <button type="button" className={`segmented__tab${kind === 'NOTICE' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'NOTICE'} onClick={() => setKind('NOTICE')}>
          {t('Aviso')}
        </button>
      </div>
      {kind === 'NOTICE' ? <p className="muted">{settings.isModerator ? t('Avisos aparecem destacados e quem vai (ou ligou o sininho) recebe uma notificação.') : t('Avisos aparecem destacados no feed.')}</p> : null}
      {settings.needsApproval ? <Notice tone="info">{t('Quem organiza aprova antes de aparecer no feed.')}</Notice> : null}
      <Field
        label={kind === 'NOTICE' ? t('Aviso') : t('O que está rolando?')}
        value={body}
        onChange={setBody}
        multiline
        maxLength={FEED_BODY_MAX + 20}
        hint={`${length}/${FEED_BODY_MAX} · ${t('Use @ para marcar alguém')}`}
        autoFocus
      />
      <MentionList people={people} onPick={(username) => setBody((current) => applyMention(current, username))} />
      {photos.length > 0 ? (
        <ul className="vpost__thumbs" aria-label={t('Fotos da publicação')}>
          {photos.map((src, i) => (
            <li key={i}>
              <img src={src} alt={t('Foto {i}', { i: i + 1 })} />
              <button type="button" className="vpost__remove" aria-label={t('Tirar foto {i}', { i: i + 1 })} onClick={() => setPhotos((current) => current.filter((_, k) => k !== i))}>
                <XIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {photos.length < FEED_IMAGES_MAX ? (
        <Button variant="secondary" full loading={reading} onClick={() => fileRef.current?.click()}>
          <PhotoIcon /> {photos.length === 0 ? t('Adicionar fotos') : t('Adicionar mais fotos')}
        </Button>
      ) : null}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void pick(e)} aria-label={t('Escolher fotos do aparelho')} />
      {message ? <Notice tone="error">{message}</Notice> : null}
      <Button full loading={busy} disabled={empty || length > FEED_BODY_MAX} onClick={() => void publish()}>
        {settings.needsApproval ? t('Enviar para aprovação') : t('Publicar')}
      </Button>
    </Sheet>
  );
}

// ---------- Quem publica / pendentes ----------

function PolicySheet({ where, targetId, current, onClose, onSaved }: { where: FeedWhere; targetId: string; current: FeedPolicy; onClose: () => void; onSaved: (s: FeedSettings) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  async function choose(policy: FeedPolicy) {
    if (policy === current || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      onSaved(await api.setFeedPolicy(where, targetId, policy));
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title={t('Quem pode publicar')} onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <div className="radiolist" role="radiogroup" aria-label={t('Quem pode publicar no feed')}>
        {FEED_POLICIES.map((policy) => (
          <label key={policy} className="radiolist__item">
            <input type="radio" name="quem-publica" checked={policy === current} disabled={busy} onChange={() => void choose(policy)} />
            <span>
              <strong>{policyLabel(policy).title}</strong>
              <span className="muted radiolist__desc">{policyLabel(policy).hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="muted">{t('Comentar e reagir continua liberado para quem vê a página.')}</p>
    </Sheet>
  );
}

function PendingSheet({ where, targetId, onClose, onApproved, onCountChange }: { where: FeedWhere; targetId: string; onClose: () => void; onApproved: (post: FeedPost) => void; onCountChange: (n: number) => void }) {
  const [items, setItems] = useState<FeedPost[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  useEffect(() => {
    api.feedPending(where, targetId).then((r) => setItems(r.items), (failure: unknown) => setError(toApiError(failure).message));
  }, [where, targetId]);

  async function decide(post: FeedPost, approve: boolean) {
    setMessage(undefined);
    try {
      if (approve) onApproved(await api.approveFeedPost(post.id));
      else await api.rejectFeedPost(post.id);
      setItems((current) => {
        const next = (current ?? []).filter((p) => p.id !== post.id);
        onCountChange(next.length);
        return next;
      });
    } catch (failure) {
      setMessage(toApiError(failure).message);
    }
  }

  return (
    <Sheet title={t('Aguardando aprovação')} onClose={onClose}>
      {error ? <ErrorState message={error} /> : null}
      {message ? <Notice tone="error">{message}</Notice> : null}
      {!items && !error ? <Loading /> : null}
      {items && items.length === 0 ? <p className="muted">{t('Nada esperando aprovação.')}</p> : null}
      <div className="feed__list feed__list--pending">
        {(items ?? []).map((post) => (
          <FeedPostCard key={post.id} post={post} onChange={() => undefined} onGone={() => undefined} onComments={() => undefined} onApprove={() => void decide(post, true)} onReject={() => void decide(post, false)} />
        ))}
      </div>
    </Sheet>
  );
}

// ---------- Comentários ----------

/** Quanto arrastar para o lado para deixar o "Apagar" à mostra, e quanto tempo segurar para abrir as opções. */
const SWIPE_OPEN = 80;
const LONG_PRESS_MS = 450;

/**
 * Um comentário. Segurar (ou clique direito) abre as opções (apagar, denunciar); arrastar para a esquerda mostra o
 * "Apagar" para quem pode apagar. Um botão escondido abre as mesmas opções pelo teclado e leitor de tela.
 */
function CommentRow({ comment, onChange, onDelete, onMenu }: { comment: FeedComment; onChange: (c: FeedComment) => void; onDelete: () => void; onMenu: () => void }) {
  const [shift, setShift] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; id: number; base: number; mode: 'wait' | 'swipe' | 'scroll' } | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const pressed = useRef(false);
  const hasMenu = comment.canDelete || comment.canReport;

  function clearTimer() {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }
  useEffect(() => clearTimer, []);

  function down(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.react')) return;
    pressed.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId, base: shift, mode: 'wait' };
    if (hasMenu) {
      timer.current = window.setTimeout(() => {
        pressed.current = true;
        gesture.current = undefined;
        setShift(0);
        if ('vibrate' in navigator) navigator.vibrate?.(10);
        onMenu();
      }, LONG_PRESS_MS);
    }
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.mode === 'wait') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimer();
      if (!comment.canDelete || Math.abs(dy) > Math.abs(dx)) {
        g.mode = 'scroll';
        return;
      }
      g.mode = 'swipe';
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (g.mode === 'swipe') setShift(Math.max(-SWIPE_OPEN - 24, Math.min(0, g.base + dx)));
  }
  function up() {
    clearTimer();
    const g = gesture.current;
    gesture.current = undefined;
    setDragging(false);
    if (g?.mode === 'swipe') setShift((s) => (s < -SWIPE_OPEN / 2 ? -SWIPE_OPEN : 0));
  }

  async function react(emoji: string | null) {
    const before = comment.reactions;
    onChange({ ...comment, reactions: applyReaction(before, emoji) });
    try {
      onChange({ ...comment, reactions: await api.reactFeedComment(comment.id, emoji) });
    } catch {
      onChange({ ...comment, reactions: before });
    }
  }
  return (
    <li className="feedcomment__row">
      {comment.canDelete ? (
        <button type="button" className="feedcomment__swipedel" onClick={onDelete} tabIndex={shift < 0 ? 0 : -1} aria-hidden={shift < 0 ? undefined : true}>
          <TrashIcon />
          <span>{t('Apagar')}</span>
        </button>
      ) : null}
      <div
        className={`comment feedcomment${dragging ? ' feedcomment--dragging' : ''}`}
        style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(event) => {
          if (!hasMenu) return;
          event.preventDefault();
          clearTimer();
          onMenu();
        }}
        onClickCapture={(event) => {
          // O toque que abriu as opções (ou fechou o "Apagar") não abre o perfil.
          if (pressed.current || shift !== 0) {
            event.preventDefault();
            event.stopPropagation();
            pressed.current = false;
            if (shift !== 0) setShift(0);
          }
        }}
      >
        <Link to={`/u/${encodeURIComponent(comment.author.username)}`} aria-label={t('Perfil de {username}', { username: comment.author.username })} draggable={false}>
          <Avatar profile={comment.author} size={32} />
        </Link>
        <div className="comment__body">
          <div className="feedcomment__bubble">
            <Link to={`/u/${encodeURIComponent(comment.author.username)}`} className="comment__name" draggable={false}>
              {comment.author.username}
            </Link>
            {comment.body ? <RichText body={comment.body} mentions={comment.mentions} className="comment__text" /> : null}
            {comment.gif ? <CommentGifView gif={comment.gif} /> : null}
          </div>
          <div className="feedcomment__meta">
            <span className="muted feedcomment__when">{timeAgo(comment.createdAt, new Date())}</span>
            <ReactButton small reactions={comment.reactions} onReact={(emoji) => void react(emoji)} />
            <ReactionSummary reactions={comment.reactions} />
            {hasMenu ? (
              <button type="button" className="visually-hidden" onClick={onMenu}>
                {t('Opções do comentário de {username}', { username: comment.author.username })}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function CommentsSheet({ post, onClose, onCountChange }: { post: FeedPost; onClose: () => void; onCountChange: (delta: number) => void }) {
  const [items, setItems] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<FeedComment | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState<FeedComment | undefined>();
  const endRef = useRef<HTMLDivElement>(null);
  const { people } = useMentionPeople(text);

  async function load(after: string | null) {
    setError(undefined);
    try {
      const page = await api.feedComments(post.id, after);
      setItems((current) => (after ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  async function send(gif?: CommentGif) {
    const body = text.trim();
    if (!body && !gif) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.addFeedComment(post.id, body, gif);
      setItems((current) => [...current, created]);
      onCountChange(1);
      setText('');
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'nearest' }));
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: FeedComment) {
    setError(undefined);
    try {
      await api.deleteFeedComment(comment.id);
      setItems((current) => current.filter((c) => c.id !== comment.id));
      onCountChange(-1);
    } catch (failure) {
      setError(toApiError(failure).message);
    }
  }

  return (
    <Sheet title={t('Comentários')} onClose={onClose}>
      {menuFor ? (
        <Sheet title={t('Opções do comentário')} onClose={() => setMenuFor(undefined)}>
          {confirmDelete ? (
            <Confirm
              danger
              question={t('Apagar este comentário?')}
              confirmLabel={t('Apagar')}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={() => {
                const target = menuFor;
                setMenuFor(undefined);
                void remove(target);
              }}
            />
          ) : (
            <ul className="sharelist">
              {menuFor.canDelete ? (
                <li>
                  <button type="button" className="sharelist__item sharelist__item--danger" onClick={() => setConfirmDelete(true)}>
                    <strong>{t('Apagar')}</strong>
                    <span>{menuFor.mine ? t('Tira o seu comentário.') : t('Você pode tirar este comentário da publicação.')}</span>
                  </button>
                </li>
              ) : null}
              {menuFor.canReport ? (
                <li>
                  <button
                    type="button"
                    className="sharelist__item sharelist__item--danger"
                    onClick={() => {
                      setReporting(menuFor);
                      setMenuFor(undefined);
                    }}
                  >
                    <strong>{t('Denunciar')}</strong>
                    <span>{t('Comentário que não deveria estar aqui.')}</span>
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </Sheet>
      ) : null}
      {reporting ? (
        <ReasonSheet
          title={t('Denunciar comentário')}
          doneText={t('Obrigado por avisar. A equipe vai analisar, e você não verá mais este comentário.')}
          submit={(reason, details) => api.reportFeedComment(reporting.id, reason, details)}
          onClose={() => setReporting(undefined)}
          onDone={() => {
            const gone = reporting;
            setReporting(undefined);
            setItems((current) => current.filter((c) => c.id !== gone.id));
            onCountChange(-1);
          }}
        />
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!loaded ? <Loading /> : null}
      {loaded && items.length === 0 && !error ? <p className="comments__empty">{t('Ainda não há nenhum comentário.')}</p> : null}
      <ul className="comments">
        {items.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            onChange={(next) => setItems((current) => current.map((x) => (x.id === next.id ? next : x)))}
            onDelete={() => void remove(c)}
            onMenu={() => {
              setConfirmDelete(false);
              setMenuFor(c);
            }}
          />
        ))}
      </ul>
      {cursor ? (
        <Button variant="quiet" small onClick={() => void load(cursor)}>
          {t('Ver mais comentários')}
        </Button>
      ) : null}
      <div ref={endRef} />
      <form
        className="comments__form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="visually-hidden" htmlFor="feed-comment-input">
          {t('Escreva um comentário')}
        </label>
        <MentionList people={people} onPick={(username) => setText((current) => applyMention(current, username))} />
        <div className="commentbox">
          <input id="feed-comment-input" className="commentbox__input" value={text} onChange={(event) => setText(event.target.value)} maxLength={FEED_COMMENT_MAX + 20} placeholder={t('Comente ou marque alguém com @')} autoComplete="off" enterKeyHint="send" />
          {text.trim() !== '' ? (
            <button type="submit" className="commentbox__send" disabled={busy} aria-label={t('Publicar comentário')} aria-busy={busy || undefined}>
              <ArrowUpIcon />
            </button>
          ) : null}
        </div>
        <CommentTools disabled={busy} onEmoji={(emoji) => setText((current) => current + emoji)} onGif={(gif) => void send(gif)} />
      </form>
    </Sheet>
  );
}

// ---------- Feed ----------

/**
 * Feed de uma página de evento ou de rolê, no estilo de página: caixa de publicar no topo, avisos e fotos do rolê,
 * reações e comentários, e a próxima página carregando sozinha ao rolar.
 * `openPostId`: abre os comentários dessa publicação (link de notificação). `openPending`: abre as pendentes (dono).
 */
export function Feed({ where, targetId, intro, openPostId, openPending, onSettings }: { where: FeedWhere; targetId: string; intro?: ReactNode; openPostId?: string | null; openPending?: boolean; onSettings?: (s: FeedSettings) => void }) {
  const auth = useAuthContext();
  const me = auth.state.status === 'user' ? auth.state.user.profile : null;
  const [settings, setSettings] = useState<FeedSettings | undefined>();
  const [items, setItems] = useState<FeedPost[]>([]);
  const [myPending, setMyPending] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  const [sheet, setSheet] = useState<'compose' | 'policy' | 'pending' | undefined>(openPending ? 'pending' : undefined);
  const [commentsFor, setCommentsFor] = useState<FeedPost | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const sentinel = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(onSettings);
  settingsRef.current = onSettings;

  function applySettings(next: FeedSettings) {
    const s = { policy: next.policy, hasModerator: next.hasModerator, isModerator: next.isModerator, canPost: next.canPost, needsApproval: next.needsApproval, pendingCount: next.pendingCount };
    setSettings(s);
    settingsRef.current?.(s);
  }

  async function load(after: string | null) {
    setLoading(true);
    setError(undefined);
    try {
      const page = await api.feed(where, targetId, { cursor: after, limit: PAGE });
      applySettings(page);
      setItems((current) => (after ? appendPage(current, page.items) : page.items));
      if (!after) setMyPending(page.myPending);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setSettings(undefined);
    setCursor(null);
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where, targetId]);

  // Link de notificação: abre direto os comentários daquela publicação.
  useEffect(() => {
    if (!openPostId) return;
    let live = true;
    api.feedPost(openPostId).then((post) => live && post.status === 'PUBLISHED' && setCommentsFor(post), () => undefined);
    return () => {
      live = false;
    };
  }, [openPostId]);

  // Rolar até perto do fim carrega a próxima página. Depois de um erro, só o "Tentar de novo" continua.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || loading || error || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(cursor);
    }, { rootMargin: '600px 0px' });
    watcher.observe(node);
    return () => watcher.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loading, error]);

  const patch = (post: FeedPost) => {
    setItems((current) => current.map((p) => (p.id === post.id ? post : p)));
    setCommentsFor((current) => (current?.id === post.id ? post : current));
  };
  const gone = (id: string) => {
    setItems((current) => current.filter((p) => p.id !== id));
    setMyPending((current) => current.filter((p) => p.id !== id));
  };

  return (
    <section className="feed" aria-label={t('Publicações')}>
      {intro}
      {settings?.canPost ? (
        <div className="feedcompose">
          {me ? <Avatar profile={me} size={40} /> : null}
          <button type="button" className="feedcompose__field" onClick={() => setSheet('compose')}>
            {settings.isModerator ? t('Escreva um aviso ou poste fotos do rolê…') : t('Poste fotos do rolê ou deixe um recado…')}
          </button>
          <button type="button" className="iconbtn feedcompose__photo" onClick={() => setSheet('compose')} aria-label={t('Postar fotos')}>
            <PhotoIcon />
          </button>
        </div>
      ) : null}
      {settings?.isModerator ? (
        <div className="feedmod">
          <button type="button" className="feedmod__chip" onClick={() => setSheet('policy')}>
            {t('Quem publica: {policy}', { policy: policyLabel(settings.policy).title })}
          </button>
          {settings.pendingCount > 0 ? (
            <button type="button" className="feedmod__chip feedmod__chip--alert" onClick={() => setSheet('pending')}>
              {settings.pendingCount === 1 ? t('1 aguardando aprovação') : t('{count} aguardando aprovação', { count: settings.pendingCount })}
            </button>
          ) : null}
        </div>
      ) : settings && !settings.canPost ? (
        <p className="muted feed__note">{settings.hasModerator ? t('Só quem organiza publica aqui, mas você pode comentar e reagir.') : t('Esta página ainda não tem responsável, então o feed está fechado por enquanto.')}</p>
      ) : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {myPending.length > 0 ? (
        <div className="feed__list">
          {myPending.map((post) => (
            <FeedPostCard key={post.id} post={post} onChange={() => undefined} onGone={gone} onComments={() => undefined} />
          ))}
        </div>
      ) : null}
      {error && items.length === 0 ? <ErrorState message={error.message} onRetry={() => void load(null)} /> : null}
      {!settings && !error ? <Loading /> : null}
      {settings && items.length === 0 && !loading && !error ? (
        <div className="feed__empty">
          <strong>{t('Nenhuma publicação ainda')}</strong>
          <span className="muted">{settings.canPost ? t('Abra o assunto: poste uma foto ou um aviso.') : t('Quando houver avisos e fotos do rolê, eles aparecem aqui.')}</span>
        </div>
      ) : null}
      <div className="feed__list">
        {items.map((post) => (
          <FeedPostCard key={post.id} post={post} onChange={patch} onGone={gone} onComments={() => setCommentsFor(post)} />
        ))}
      </div>
      {error && items.length > 0 ? <ErrorState message={error.message} onRetry={() => void load(cursor)} /> : null}
      {cursor ? (
        <div ref={sentinel} className="feed__more">
          {loading ? <Loading /> : typeof IntersectionObserver === 'undefined' ? <Button variant="secondary" onClick={() => void load(cursor)}>{t('Carregar mais')}</Button> : null}
        </div>
      ) : null}

      {sheet === 'compose' && settings ? (
        <ComposeSheet
          where={where}
          targetId={targetId}
          settings={settings}
          onClose={() => setSheet(undefined)}
          onCreated={(post) => {
            setSheet(undefined);
            if (post.status === 'PENDING') {
              setMyPending((current) => [post, ...current]);
              setNotice(t('Enviado! Aparece no feed quando quem organiza aprovar.'));
            } else {
              setItems((current) => [post, ...current]);
              setNotice(undefined);
            }
          }}
        />
      ) : null}
      {sheet === 'policy' && settings ? (
        <PolicySheet
          where={where}
          targetId={targetId}
          current={settings.policy}
          onClose={() => setSheet(undefined)}
          onSaved={(s) => {
            applySettings(s);
            setSheet(undefined);
          }}
        />
      ) : null}
      {sheet === 'pending' ? (
        <PendingSheet
          where={where}
          targetId={targetId}
          onClose={() => setSheet(undefined)}
          onApproved={(post) => setItems((current) => [post, ...current].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)))}
          onCountChange={(n) => settings && applySettings({ ...settings, pendingCount: n })}
        />
      ) : null}
      {commentsFor ? <CommentsSheet post={commentsFor} onClose={() => setCommentsFor(undefined)} onCountChange={(delta) => patch({ ...commentsFor, commentCount: Math.max(0, commentsFor.commentCount + delta) })} /> : null}
    </section>
  );
}
