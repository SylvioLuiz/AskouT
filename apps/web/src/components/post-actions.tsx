import { useEffect, useRef, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { CropEditor } from './crop.tsx';
import { ArrowUpIcon, CropIcon } from './icons.tsx';
import { Avatar, Button, Confirm, ErrorState, Field, GroupAvatar, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { cropPostPhoto } from '../lib/image.ts';
import type { CropRect } from '../lib/crop.ts';
import { toApiError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import { eventProblem, isoToLocalInput, localToIso, POST_CAPTION_MAX } from '../lib/post-draft.ts';
import { postLink, postShareText } from '../lib/share.ts';
import type { ConversationItem, PostComment, PostView, ReportReason } from '../lib/types.ts';
import { Link } from '../router.tsx';

export type PostGone = 'deleted' | 'hidden' | 'archived';

// ---------- Menu ⋯ ----------

/** Opções do post: de outra pessoa (denunciar, não tenho interesse) ou suas (editar, ajustar, arquivar, excluir). */
export function PostMenuSheet({ post, onClose, onEdit, onAdjust, onReport, onArchiveToggle, onNotInterested, onDelete, busy }: {
  post: PostView;
  onClose: () => void;
  onEdit: () => void;
  onAdjust: () => void;
  onReport: () => void;
  onArchiveToggle: () => void;
  onNotInterested: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const item = (label: string, hint: string, onClick: () => void, extra?: { danger?: boolean; icon?: boolean }) => (
    <li>
      <button type="button" className={`sharelist__item${extra?.danger ? ' sharelist__item--danger' : ''}`} onClick={onClick} disabled={busy}>
        <strong>
          {label}
          {extra?.icon ? (
            <>
              {' '}
              <span className="inlineicon">
                <CropIcon />
              </span>
            </>
          ) : null}
        </strong>
        <span>{hint}</span>
      </button>
    </li>
  );
  return (
    <Sheet title="Opções do post" onClose={onClose}>
      {confirming ? (
        <Confirm danger question="Excluir este post? As fotos, curtidas e comentários são removidos." confirmLabel="Excluir" busy={busy} onCancel={() => setConfirming(false)} onConfirm={onDelete} />
      ) : post.mine ? (
        <ul className="sharelist">
          {item('Editar', 'Legenda, lugar e dados do evento.', onEdit)}
          {item('Ajustar', 'Recortar as fotos que você enviou.', onAdjust, { icon: true })}
          {item(post.archived ? 'Desarquivar' : 'Arquivar', post.archived ? 'O post volta para o seu perfil e o feed.' : 'Só você vê. Sai do feed e do seu perfil.', onArchiveToggle)}
          {item('Excluir', 'Apaga o post para sempre.', () => setConfirming(true), { danger: true })}
        </ul>
      ) : (
        <ul className="sharelist">
          {item('Denunciar', 'Conteúdo que não deveria estar aqui.', onReport, { danger: true })}
          {item('Não tenho interesse', 'Deixa de mostrar este post no seu feed.', onNotInterested)}
        </ul>
      )}
    </Sheet>
  );
}

// ---------- Denunciar ----------

const REASONS: { id: ReportReason; label: string }[] = [
  { id: 'SPAM', label: 'Spam ou propaganda' },
  { id: 'OFFENSIVE', label: 'Ofensivo ou discurso de ódio' },
  { id: 'NUDITY', label: 'Nudez ou conteúdo sexual' },
  { id: 'VIOLENCE', label: 'Violência' },
  { id: 'FALSE_INFO', label: 'Informação falsa' },
  { id: 'OTHER', label: 'Outro motivo' },
];

export function ReportSheet({ postId, onClose, onDone }: { postId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason | undefined>();
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [sent, setSent] = useState(false);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await api.reportPost(postId, reason, details.trim() || undefined);
      setSent(true);
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Sheet title="Denúncia enviada" onClose={onDone}>
        <p>Obrigado por avisar. A equipe vai analisar, e você não verá mais este post.</p>
        <Button full onClick={onDone}>
          Fechar
        </Button>
      </Sheet>
    );
  }
  return (
    <Sheet title="Denunciar post" onClose={onClose}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="reasons" role="radiogroup" aria-label="Motivo da denúncia">
        {REASONS.map((r) => (
          <label key={r.id} className={`reasons__item${reason === r.id ? ' reasons__item--on' : ''}`}>
            <input type="radio" name="motivo" checked={reason === r.id} onChange={() => setReason(r.id)} />
            <span>{r.label}</span>
          </label>
        ))}
      </div>
      <Field label="Detalhes (opcional)" value={details} onChange={setDetails} multiline maxLength={320} />
      <Button full disabled={!reason} loading={busy} onClick={() => void send()}>
        Enviar denúncia
      </Button>
    </Sheet>
  );
}

// ---------- Comentários ----------

function CommentRow({ comment, onDelete, busy }: { comment: PostComment; onDelete: () => void; busy: boolean }) {
  return (
    <li className="comment">
      <Link to={`/u/${encodeURIComponent(comment.author.username)}`} aria-label={`Perfil de ${comment.author.displayName}`}>
        <Avatar profile={comment.author} size={32} />
      </Link>
      <div className="comment__body">
        <p>
          <Link to={`/u/${encodeURIComponent(comment.author.username)}`} className="comment__name">
            {comment.author.displayName}
          </Link>{' '}
          <span className="muted">{timeAgo(comment.createdAt, new Date())}</span>
        </p>
        <p className="comment__text">{comment.body}</p>
      </div>
      {comment.canDelete ? (
        <button type="button" className="linkbtn comment__del" onClick={onDelete} disabled={busy} aria-label="Apagar comentário">
          Apagar
        </button>
      ) : null}
    </li>
  );
}

export function CommentsSheet({ postId, onClose, onCountChange }: { postId: string; onClose: () => void; onCountChange: (delta: number) => void }) {
  const [items, setItems] = useState<PostComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);

  async function load(offset: number) {
    setError(undefined);
    try {
      const page = await api.postComments(postId, { limit: 20, offset });
      setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setHasMore(page.hasMore);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.addComment(postId, body);
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

  async function remove(comment: PostComment) {
    setDeleting(comment.id);
    setError(undefined);
    try {
      await api.deleteComment(postId, comment.id);
      setItems((current) => current.filter((c) => c.id !== comment.id));
      onCountChange(-1);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setDeleting(undefined);
    }
  }

  return (
    <Sheet title="Comentários" onClose={onClose}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!loaded ? <Loading /> : null}
      {loaded && items.length === 0 && !error ? <p className="comments__empty">Ainda não há nenhum comentário.</p> : null}
      <ul className="comments">
        {items.map((c) => (
          <CommentRow key={c.id} comment={c} busy={deleting === c.id} onDelete={() => void remove(c)} />
        ))}
      </ul>
      {hasMore ? (
        <Button variant="quiet" small onClick={() => void load(items.length)}>
          Ver mais comentários
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
        <label className="visually-hidden" htmlFor="comment-input">
          Escreva um comentário
        </label>
        <div className="commentbox">
          <input id="comment-input" className="commentbox__input" value={text} onChange={(event) => setText(event.target.value)} maxLength={520} placeholder="Escreva um comentário" autoComplete="off" enterKeyHint="send" />
          {text.trim() !== '' ? (
            <button type="submit" className="commentbox__send" disabled={busy} aria-label="Publicar comentário" aria-busy={busy || undefined}>
              <ArrowUpIcon />
            </button>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}

// ---------- Editar ----------

export function EditPostSheet({ post, onClose, onSaved }: { post: PostView; onClose: () => void; onSaved: (post: PostView) => void }) {
  const [caption, setCaption] = useState(post.caption ?? '');
  const [placeName, setPlaceName] = useState(post.placeName ?? '');
  const [placeAddress, setPlaceAddress] = useState(post.placeAddress ?? '');
  const [kind, setKind] = useState<'POST' | 'EVENT'>(post.event ? 'EVENT' : 'POST');
  const [title, setTitle] = useState(post.event?.title ?? '');
  const [starts, setStarts] = useState(post.event ? isoToLocalInput(post.event.startsAt) : '');
  const [ends, setEnds] = useState(post.event ? isoToLocalInput(post.event.endsAt) : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  async function save() {
    setMessage(undefined);
    const place = placeName.trim() ? { name: placeName.trim(), address: placeAddress.trim() || null } : null;
    // O início só precisa estar no futuro se a pessoa mudou o horário.
    const unchanged = post.event && starts === isoToLocalInput(post.event.startsAt);
    if (kind === 'EVENT') {
      const problem = eventProblem({ title, startsAt: starts, endsAt: ends }, place, unchanged ? new Date(0) : new Date());
      if (problem) {
        setMessage({ tone: 'error', text: problem });
        return;
      }
    }
    setBusy(true);
    try {
      const updated = await api.editPost(post.id, {
        caption: caption.trim() || null,
        placeName: place?.name ?? null,
        placeAddress: place?.address ?? null,
        event: kind === 'EVENT' ? { title: title.trim(), startsAt: localToIso(starts), endsAt: ends ? localToIso(ends) : null } : null,
      });
      onSaved(updated);
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
      setBusy(false);
    }
  }

  return (
    <Sheet title="Editar post" onClose={onClose}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="segmented" role="group" aria-label="Tipo de publicação">
        <button type="button" className={`segmented__tab${kind === 'POST' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'POST'} onClick={() => setKind('POST')}>
          Post
        </button>
        <button type="button" className={`segmented__tab${kind === 'EVENT' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'EVENT'} onClick={() => setKind('EVENT')}>
          Evento
        </button>
      </div>
      {kind === 'EVENT' ? (
        <>
          <Field label="Nome do evento" value={title} onChange={setTitle} maxLength={120} />
          <Field label="Começa" type="datetime-local" value={starts} onChange={setStarts} />
          <Field label="Termina (opcional)" type="datetime-local" value={ends} onChange={setEnds} />
        </>
      ) : null}
      <Field label="Descrição" value={caption} onChange={setCaption} multiline maxLength={POST_CAPTION_MAX + 20} hint={`${Array.from(caption).length}/${POST_CAPTION_MAX}`} />
      <Field label={kind === 'EVENT' ? 'Lugar (obrigatório no evento)' : 'Lugar (opcional)'} value={placeName} onChange={setPlaceName} maxLength={120} />
      {placeName.trim() ? <Field label="Endereço (opcional)" value={placeAddress} onChange={setPlaceAddress} maxLength={200} /> : null}
      <Button full loading={busy} disabled={Array.from(caption).length > POST_CAPTION_MAX} onClick={() => void save()}>
        Salvar
      </Button>
    </Sheet>
  );
}

// ---------- Ajustar (recortar as fotos já publicadas) ----------

async function toDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Não foi possível abrir a foto.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível abrir a foto.'));
    reader.readAsDataURL(blob);
  });
}

export function AdjustSheet({ post, onClose, onSaved }: { post: PostView; onClose: () => void; onSaved: (post: PostView) => void }) {
  const uploads = post.images.filter((i) => i.kind === 'UPLOAD' && i.path);
  const [chosen, setChosen] = useState<string | undefined>(uploads.length === 1 ? uploads[0]?.id : undefined);
  const [source, setSource] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  useEffect(() => {
    setSource(undefined);
    const image = uploads.find((i) => i.id === chosen);
    if (!image?.path) return;
    let cancelled = false;
    toDataUrl(api.assetUrl(image.path))
      .then((url) => {
        if (!cancelled) setSource(url);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : 'Não foi possível abrir a foto.' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen]);

  async function apply(rect: CropRect) {
    if (!source || !chosen) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const cropped = await cropPostPhoto(source, rect);
      onSaved(await api.adjustPostImage(post.id, chosen, cropped));
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : toApiError(failure).message });
      setBusy(false);
    }
  }

  return (
    <Sheet title="Ajustar foto" onClose={onClose}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {uploads.length === 0 ? <p className="muted">Só fotos que você enviou podem ser ajustadas. A foto de um lugar não pode ser recortada.</p> : null}
      {uploads.length > 1 ? (
        <>
          <p className="muted">Escolha a foto para recortar.</p>
          <ul className="composegrid" aria-label="Fotos do post">
            {uploads.map((image, i) => (
              <li key={image.id} className={`composegrid__item${image.id === chosen ? ' composegrid__item--on' : ''}`}>
                <button type="button" className="composegrid__pick" onClick={() => setChosen(image.id)} aria-label={`Ajustar foto ${i + 1}`} aria-pressed={image.id === chosen}>
                  {image.path ? <img src={api.assetUrl(image.path)} alt="" /> : null}
                  <span className="composegrid__n">{i + 1}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {chosen && !source && !message ? <Loading /> : null}
      {chosen && source ? <CropEditor key={chosen} source={source} busy={busy} onApply={(rect) => void apply(rect)} onCancel={onClose} /> : null}
      {chosen ? <p className="muted">O recorte parte da foto já publicada (até 720 px).</p> : null}
    </Sheet>
  );
}

// ---------- Compartilhar ----------

export function SharePostSheet({ post, onClose }: { post: PostView; onClose: () => void }) {
  const [step, setStep] = useState<'menu' | 'chat'>('menu');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const chats = useAsync(() => (step === 'chat' ? api.conversations() : Promise.resolve(null)), [step]);
  const url = postLink(window.location.origin, post.id);
  const text = postShareText(post.author.displayName);

  async function outside() {
    setMessage(undefined);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'AskouT', text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'ok', text: 'Link copiado. Cole onde quiser, por exemplo no WhatsApp.' });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: `Não foi possível copiar. O link é ${url}` });
    }
  }

  async function sendTo(conversation: ConversationItem) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.sendText(conversation.id, `${text}: ${url}`);
      setMessage({ tone: 'ok', text: `Enviado para ${conversation.type === 'GROUP' ? (conversation.name ?? 'o grupo') : (conversation.other?.displayName ?? 'a conversa')}.` });
      setStep('menu');
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  const sendable = (chats.data?.items ?? []).filter((c) => c.canSend);
  return (
    <Sheet title="Compartilhar" onClose={onClose}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {step === 'menu' ? (
        <ul className="sharelist">
          <li>
            <button type="button" className="sharelist__item" onClick={() => setStep('chat')}>
              <strong>Enviar em uma conversa</strong>
              <span>Mande o link para um amigo ou um grupo.</span>
            </button>
          </li>
          <li>
            <button type="button" className="sharelist__item" onClick={() => void outside()}>
              <strong>Fora do app</strong>
              <span>WhatsApp, redes sociais ou copiar o link.</span>
            </button>
          </li>
        </ul>
      ) : (
        <>
          {chats.loading && !chats.data ? <Loading /> : null}
          {chats.error ? <ErrorState message={chats.error.message} onRetry={chats.reload} /> : null}
          {chats.data && sendable.length === 0 ? <p className="muted">Você ainda não tem conversas. Siga alguém que também te segue para conversar.</p> : null}
          <ul className="sharelist">
            {sendable.map((c) => (
              <li key={c.id}>
                <button type="button" className="sharelist__item sharelist__item--person" onClick={() => void sendTo(c)} disabled={busy}>
                  {c.type === 'GROUP' ? <GroupAvatar name={c.name ?? 'Grupo'} size={40} imageUrl={c.imageUrl} /> : c.other ? <Avatar profile={c.other} size={40} /> : null}
                  <strong>{c.type === 'GROUP' ? (c.name ?? 'Grupo') : (c.other?.displayName ?? 'Conversa')}</strong>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="quiet" small onClick={() => setStep('menu')}>
            Voltar
          </Button>
        </>
      )}
    </Sheet>
  );
}
