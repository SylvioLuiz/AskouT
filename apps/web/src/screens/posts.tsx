import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CropIcon, XIcon } from '../components/icons.tsx';
import { FriendPicker } from '../components/meetup.tsx';
import { CropEditor } from '../components/crop.tsx';
import { PostCard, PostList } from '../components/post.tsx';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { cropPostPhoto, readPostSource, resizePostPhoto } from '../lib/image.ts';
import type { CropRect } from '../lib/crop.ts';
import { toggleId } from '../lib/meetup.ts';
import { addImages, buildPostBody, effectivePlace, eventProblem, POST_CAPTION_MAX, POST_IMAGES_MAX } from '../lib/post-draft.ts';
import type { DraftImage, LinkedPlace } from '../lib/post-draft.ts';
import type { ExplorePlace } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';

let counter = 0;
const nextKey = () => `i${(counter += 1)}`;

/** Busca lugares perto de você. Com `withPhoto`, só os que têm foto do Google. */
function usePlaceSearch(q: string, withPhoto: boolean) {
  const term = useDebounced(q.trim(), 350);
  const where = useCurrentPosition();
  const position = where.status === 'ok' ? where.position : undefined;
  const result = useAsync(
    () => (term.length >= 2 && position ? api.explore({ q: term, lat: position.lat, lng: position.lng }) : Promise.resolve(null)),
    [term, position?.lat, position?.lng],
  );
  const places = (result.data?.places ?? []).filter((p) => !withPhoto || p.photoPath);
  return { term, where, result, places };
}

function LocationNotice({ status }: { status: string }) {
  return status === 'denied' || status === 'unavailable' ? <Notice tone="error">Para achar lugares perto de você, permita a localização no navegador.</Notice> : null;
}

/** Escolher o lugar a vincular ao post (qualquer lugar, com ou sem foto). */
function LinkPlaceSheet({ onPick, onClose }: { onPick: (place: LinkedPlace) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const { term, where, result, places } = usePlaceSearch(q, false);
  return (
    <Sheet title="Vincular um lugar" onClose={onClose}>
      <Field label="Buscar lugar" type="search" value={q} onChange={setQ} autoFocus autoComplete="off" hint="Ex.: bar, café, parque" />
      <LocationNotice status={where.status} />
      {term.length < 2 ? <p className="muted">Digite o nome ou o tipo do lugar.</p> : null}
      {result.loading && !result.data ? <Loading /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && !result.data.placesAvailable ? <Notice>A busca de lugares ainda não está ligada neste ambiente.</Notice> : null}
      {result.data && result.data.placesAvailable && places.length === 0 ? <p className="muted">Nenhum lugar encontrado.</p> : null}
      <ul className="placepick">
        {places.map((p) => (
          <li key={p.key}>
            <button type="button" className="placepick__item" onClick={() => onPick({ name: p.name, address: p.address })}>
              <span>
                <strong>{p.name}</strong>
                {p.address ? <span className="muted"> {p.address}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Etapa 1, aba "Foto de um lugar": grade com as fotos dos lugares perto de você. */
function PlacePhotoGrid({ picked, onPick }: { picked: string | undefined; onPick: (place: ExplorePlace) => void }) {
  const [q, setQ] = useState('');
  const { term, where, result, places } = usePlaceSearch(q, true);
  return (
    <>
      <Field label="Buscar lugar" type="search" value={q} onChange={setQ} autoComplete="off" hint="Ex.: bar, café, parque" />
      <LocationNotice status={where.status} />
      {term.length < 2 ? <p className="muted">Digite o nome ou o tipo do lugar para ver as fotos.</p> : null}
      {result.loading && !result.data ? <Loading /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && !result.data.placesAvailable ? <Notice>A busca de lugares com foto ainda não está ligada neste ambiente.</Notice> : null}
      {result.data && result.data.placesAvailable && places.length === 0 ? <p className="muted">Nenhum lugar com foto para essa busca.</p> : null}
      <ul className="placegrid" aria-label="Fotos de lugares">
        {places.map((p) => (
          <li key={p.key}>
            <button type="button" className="placegrid__item" aria-pressed={picked === p.name} onClick={() => onPick(p)}>
              <img src={api.assetUrl(p.photoPath as string)} alt="" referrerPolicy="no-referrer" />
              <span className="placegrid__name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">Fotos de lugares são do Google, com o crédito de quem tirou.</p>
    </>
  );
}

type Step = 'photos' | 'details';
type Source = 'photos' | 'place';

export function CreatePostScreen() {
  useTitle('Nova publicação');
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('photos');
  const [source, setSource] = useState<Source>('photos');
  const [items, setItems] = useState<DraftImage[]>([]);
  const [focusKey, setFocusKey] = useState<string | undefined>();
  const [caption, setCaption] = useState('');
  const [linked, setLinked] = useState<LinkedPlace | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [linking, setLinking] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [cropKey, setCropKey] = useState<string | undefined>();
  const [cropBusy, setCropBusy] = useState(false);
  const [kind, setKind] = useState<'POST' | 'EVENT'>('POST');
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const friends = useAsync(() => api.friends(), []);

  const room = POST_IMAGES_MAX - items.length;
  const focused = items.find((i) => i.key === focusKey) ?? items[0];
  const place = effectivePlace(items, linked);
  const placePhoto = items.find((i): i is Extract<DraftImage, { kind: 'PLACE' }> => i.kind === 'PLACE');
  const placeFromPhoto = placePhoto !== undefined;
  const tagged = (friends.data ?? []).filter((f) => tags.includes(f.userId));

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setMessage(undefined);
    setReading(true);
    const added: DraftImage[] = [];
    const skipped: string[] = [];
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        const dataUrl = await resizePostPhoto(file);
        const source = await readPostSource(file).catch(() => undefined);
        added.push({ key: nextKey(), kind: 'UPLOAD', preview: dataUrl, dataUrl, ...(source ? { source } : {}) });
      } catch (failure) {
        skipped.push(`${file.name}: ${failure instanceof Error ? failure.message : 'não foi possível usar'}`);
      }
    }
    setItems((current) => addImages(current, added));
    if (added[0]) setFocusKey(added[0].key);
    const extra = files.length - Math.max(room, 0);
    if (extra > 0) skipped.push(`Só cabem ${POST_IMAGES_MAX} fotos: ${extra} ficou de fora.`);
    if (skipped.length > 0) setMessage({ tone: 'error', text: skipped.join(' ') });
    setReading(false);
  }

  function pickPlacePhoto(p: ExplorePlace) {
    if (!p.photoPath) return;
    const image: DraftImage = { key: nextKey(), kind: 'PLACE', preview: api.assetUrl(p.photoPath), photoPath: p.photoPath, author: p.photoAuthor, placeName: p.name, placeAddress: p.address };
    const next = addImages(items, [image]);
    if (!next.includes(image)) {
      setMessage({ tone: 'error', text: `Já são ${POST_IMAGES_MAX} fotos. Remova uma para usar a foto do lugar.` });
      return;
    }
    setItems(next);
    setFocusKey(image.key);
    setMessage(undefined);
  }

  async function applyCrop(key: string, rect: CropRect) {
    const target = items.find((i) => i.key === key);
    if (!target || target.kind !== 'UPLOAD' || !target.source) return;
    setCropBusy(true);
    try {
      const dataUrl = await cropPostPhoto(target.source, rect);
      setItems((current) => current.map((i) => (i.key === key && i.kind === 'UPLOAD' ? { ...i, dataUrl, preview: dataUrl, crop: rect } : i)));
      setCropKey(undefined);
      setMessage(undefined);
    } catch (failure) {
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : 'Não foi possível recortar a foto.' });
    } finally {
      setCropBusy(false);
    }
  }

  function remove(key: string) {
    setItems((current) => current.filter((i) => i.key !== key));
    setMessage(undefined);
  }

  async function publish() {
    setBusy(true);
    setMessage(undefined);
    const eventDraft = kind === 'EVENT' ? { title: eventTitle, startsAt: eventStart, endsAt: eventEnd } : null;
    const problem = eventDraft ? eventProblem(eventDraft, effectivePlace(items, linked), new Date()) : null;
    if (problem) {
      setMessage({ tone: 'error', text: problem });
      setBusy(false);
      return;
    }
    try {
      const created = await api.createPost(buildPostBody(items, caption, linked, tags, eventDraft));
      navigate(created.event ? '/perfil?aba=eventos' : `/posts/${encodeURIComponent(created.id)}`);
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
      setBusy(false);
    }
  }

  const fileInput = <input ref={fileRef} type="file" accept="image/*" multiple className="visually-hidden" id="fotos-post" onChange={addFiles} />;

  if (step === 'details') {
    return (
      <div className="compose">
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={() => setStep('photos')} aria-label="Voltar para as fotos">
            <span aria-hidden="true">‹</span>
          </button>
          <h1 className="compose__title">Detalhes</h1>
          <Button small loading={busy} disabled={Array.from(caption).length > POST_CAPTION_MAX} onClick={publish}>
            Compartilhar
          </Button>
        </header>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <ul className="composestrip" aria-label="Fotos do post">
          {items.map((item, i) => (
            <li key={item.key}>
              <img src={item.preview} alt={`Foto ${i + 1}`} referrerPolicy="no-referrer" />
            </li>
          ))}
        </ul>
        <div className="segmented" role="group" aria-label="Tipo de publicação">
          <button type="button" className={`segmented__tab${kind === 'POST' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'POST'} onClick={() => setKind('POST')}>
            Post
          </button>
          <button type="button" className={`segmented__tab${kind === 'EVENT' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'EVENT'} onClick={() => setKind('EVENT')}>
            Evento
          </button>
        </div>
        {kind === 'EVENT' ? (
          <section className="compose__row" aria-label="Dados do evento">
            <Field label="Nome do evento" value={eventTitle} onChange={setEventTitle} maxLength={120} />
            <Field label="Começa" type="datetime-local" value={eventStart} onChange={setEventStart} />
            <Field label="Termina (opcional)" type="datetime-local" value={eventEnd} onChange={setEventEnd} hint="Sem horário de fim, o evento dura 3 horas." />
            <p className="muted">Um evento precisa de um lugar. Escolha abaixo.</p>
          </section>
        ) : null}
        <Field label="Descrição (opcional)" value={caption} onChange={setCaption} multiline maxLength={POST_CAPTION_MAX + 20} hint={`${Array.from(caption).length}/${POST_CAPTION_MAX}`} />

        <section className="compose__row" aria-labelledby="lugar-titulo">
          <h2 id="lugar-titulo" className="compose__h">
            Lugar
          </h2>
          {place ? (
            <p className="compose__value">
              <strong>{place.name}</strong>
              {place.address ? <span className="muted"> {place.address}</span> : null}
            </p>
          ) : (
            <p className="muted">Nenhum lugar vinculado.</p>
          )}
          {placeFromPhoto ? (
            <p className="muted">O lugar vem da foto do lugar que você escolheu.</p>
          ) : (
            <div className="row-actions">
              <Button variant="secondary" small onClick={() => setLinking(true)}>
                {linked ? 'Trocar lugar' : 'Vincular um lugar'}
              </Button>
              {linked ? (
                <Button variant="quiet" small onClick={() => setLinked(null)}>
                  Remover
                </Button>
              ) : null}
            </div>
          )}
        </section>

        <section className="compose__row" aria-labelledby="pessoas-titulo">
          <h2 id="pessoas-titulo" className="compose__h">
            Marcar pessoas
          </h2>
          {tagged.length > 0 ? (
            <ul className="chips" aria-label="Pessoas marcadas">
              {tagged.map((f) => (
                <li key={f.userId} className="chip">
                  <Avatar profile={f} size={24} />
                  <span>{f.username}</span>
                  <button type="button" onClick={() => setTags((c) => c.filter((id) => id !== f.userId))} aria-label={`Tirar a marcação de ${f.username}`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="row-actions">
            <Button variant="secondary" small onClick={() => setTagging(true)}>
              {tags.length > 0 ? 'Mudar marcações' : 'Marcar amigos'}
            </Button>
          </div>
          <p className="muted">Só amigos. Cada pessoa precisa aceitar a marcação para o post aparecer no perfil e no feed dela.</p>
        </section>

        {linking ? (
          <LinkPlaceSheet
            onPick={(p) => {
              setLinked(p);
              setLinking(false);
            }}
            onClose={() => setLinking(false)}
          />
        ) : null}
        {tagging ? (
          <Sheet title="Marcar pessoas" onClose={() => setTagging(false)}>
            <FriendPicker picked={tags} onToggle={(id) => setTags((c) => toggleId(c, id))} />
            <Button full onClick={() => setTagging(false)}>
              Concluir
            </Button>
          </Sheet>
        ) : null}
      </div>
    );
  }

  return (
    <div className="compose">
      <header className="compose__bar">
        <Link to="/" className="iconbtn" aria-label="Cancelar">
          <XIcon />
        </Link>
        <h1 className="compose__title">Nova publicação</h1>
        <Button small disabled={items.length === 0 || reading || cropKey !== undefined} onClick={() => setStep('details')}>
          Avançar
        </Button>
      </header>
      {fileInput}

      <div className="segmented" role="tablist" aria-label="De onde vem a foto">
        <button type="button" role="tab" aria-selected={source === 'photos'} className={`segmented__tab${source === 'photos' ? ' segmented__tab--on' : ''}`} onClick={() => setSource('photos')}>
          Escolher fotos
        </button>
        <button type="button" role="tab" aria-selected={source === 'place'} className={`segmented__tab${source === 'place' ? ' segmented__tab--on' : ''}`} onClick={() => setSource('place')}>
          Foto de um lugar
        </button>
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {cropKey && focused && focused.key === cropKey && focused.kind === 'UPLOAD' && focused.source ? (
        <CropEditor source={focused.source} initial={focused.crop} busy={cropBusy} onApply={(rect) => void applyCrop(focused.key, rect)} onCancel={() => setCropKey(undefined)} />
      ) : (
      <div className="compose__stage">
        {focused ? (
          <img src={focused.preview} alt="Foto em destaque" referrerPolicy="no-referrer" />
        ) : source === 'photos' ? (
          <button type="button" className="compose__empty" onClick={() => fileRef.current?.click()} disabled={reading}>
            {reading ? 'Preparando as fotos…' : 'Toque para abrir a galeria'}
          </button>
        ) : (
          <p className="compose__empty">Busque um lugar abaixo para usar a foto dele.</p>
        )}
        {focused && focused.kind === 'UPLOAD' && focused.source ? (
          <button type="button" className="stage__crop" onClick={() => setCropKey(focused.key)} aria-label="Recortar foto" title="Recortar">
            <CropIcon />
          </button>
        ) : null}
      </div>
      )}

      {items.length > 0 ? (
        <ul className="composegrid" aria-label="Fotos escolhidas">
          {items.map((item, i) => (
            <li key={item.key} className={`composegrid__item${item.key === focused?.key ? ' composegrid__item--on' : ''}`}>
              <button type="button" className="composegrid__pick" onClick={() => { if (cropKey === undefined) setFocusKey(item.key); }} disabled={cropKey !== undefined && item.key !== cropKey} aria-label={`Ver foto ${i + 1}`} aria-pressed={item.key === focused?.key}>
                <img src={item.preview} alt="" referrerPolicy="no-referrer" />
                <span className="composegrid__n">{i + 1}</span>
              </button>
              <button type="button" className="composegrid__remove" onClick={() => remove(item.key)} aria-label={`Remover foto ${i + 1}`}>
                ×
              </button>
            </li>
          ))}
          {source === 'photos' && room > 0 ? (
            <li className="composegrid__item">
              <button type="button" className="composegrid__add" onClick={() => fileRef.current?.click()} disabled={reading} aria-label="Adicionar fotos">
                +
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className="muted">{items.length}/{POST_IMAGES_MAX} fotos. As fotos são reduzidas antes de enviar.</p>

      {source === 'place' ? <PlacePhotoGrid picked={placePhoto?.placeName} onPick={pickPlacePhoto} /> : null}
    </div>
  );
}

/** Posts que você arquivou: só você vê. Pelo menu ⋯ do post dá para desarquivar. */
export function ArchivedScreen() {
  useTitle('Arquivados');
  return (
    <>
      <PageHead title="Arquivados" back="/perfil" />
      <p className="muted">Posts que você arquivou ficam fora do feed e do seu perfil. Só você vê.</p>
      <PostList load={(offset) => api.archivedPosts({ limit: 12, offset })} emptyTitle="Nada arquivado" emptyHint="Use o menu ⋯ de um post seu e escolha Arquivar." />
    </>
  );
}

export function PostScreen({ postId }: { postId: string }) {
  useTitle('Post');
  const post = useAsync(() => api.post(postId), [postId]);
  if (post.loading && !post.data) return <Loading />;
  if (post.error) {
    return post.error.code === 'NOT_FOUND' ? (
      <EmptyState
        title="Post não encontrado"
        action={
          <Link to="/" className="btn btn--secondary">
            Ir para a Home
          </Link>
        }
      >
        Ele foi apagado ou você não pode vê-lo.
      </EmptyState>
    ) : (
      <ErrorState message={post.error.message} onRetry={post.reload} />
    );
  }
  if (!post.data) return null;
  return (
    <>
      <PageHead title="Post" back={`/u/${encodeURIComponent(post.data.author.username)}`} />
      <PostCard post={post.data} onGone={(_id, why) => navigate(why === 'hidden' ? '/' : '/perfil')} />
    </>
  );
}
