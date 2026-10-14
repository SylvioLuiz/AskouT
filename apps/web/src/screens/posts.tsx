import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { PostCard } from '../components/post.tsx';
import { Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { resizePostPhoto } from '../lib/image.ts';
import type { ExplorePlace, PostImageInput } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';

export const POST_IMAGES_MAX = 5;
export const POST_CAPTION_MAX = 500;

type Item =
  | { key: string; kind: 'UPLOAD'; preview: string; dataUrl: string }
  | { key: string; kind: 'PLACE'; preview: string; photoPath: string; author: string | null; placeName: string; placeAddress: string | null };

let counter = 0;
const nextKey = () => `i${(counter += 1)}`;

function PlacePhotoSheet({ onPick, onClose }: { onPick: (place: ExplorePlace) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 350);
  const where = useCurrentPosition();
  const position = where.status === 'ok' ? where.position : undefined;
  const result = useAsync(
    () => (term.length >= 2 && position ? api.explore({ q: term, lat: position.lat, lng: position.lng }) : Promise.resolve(null)),
    [term, position?.lat, position?.lng],
  );
  const places = (result.data?.places ?? []).filter((p) => p.photoPath);
  return (
    <Sheet title="Foto de um lugar" onClose={onClose}>
      <Field label="Buscar lugar" type="search" value={q} onChange={setQ} autoFocus autoComplete="off" hint="Ex.: bar, café, parque" />
      {where.status === 'denied' || where.status === 'unavailable' ? <Notice tone="error">Para achar lugares perto de você, permita a localização no navegador.</Notice> : null}
      {term.length < 2 ? <p className="muted">Digite o nome ou o tipo do lugar.</p> : null}
      {result.loading && !result.data ? <Loading /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && !result.data.placesAvailable ? <Notice>A busca de lugares com foto ainda não está ligada neste ambiente.</Notice> : null}
      {result.data && result.data.placesAvailable && places.length === 0 ? <p className="muted">Nenhum lugar com foto para essa busca.</p> : null}
      <ul className="placepick">
        {places.map((p) => (
          <li key={p.key}>
            <button type="button" className="placepick__item" onClick={() => onPick(p)}>
              <img src={api.assetUrl(p.photoPath as string)} alt="" referrerPolicy="no-referrer" />
              <span>
                <strong>{p.name}</strong>
                {p.address ? <span className="muted"> {p.address}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">Fotos de lugares são do Google, com o crédito de quem tirou.</p>
    </Sheet>
  );
}

export function CreatePostScreen() {
  useTitle('Novo post');
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [picking, setPicking] = useState(false);

  const room = POST_IMAGES_MAX - items.length;
  const hasPlace = items.some((i) => i.kind === 'PLACE');

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setMessage(undefined);
    setReading(true);
    const added: Item[] = [];
    const skipped: string[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const dataUrl = await resizePostPhoto(file);
        added.push({ key: nextKey(), kind: 'UPLOAD', preview: dataUrl, dataUrl });
      } catch (failure) {
        skipped.push(`${file.name}: ${failure instanceof Error ? failure.message : 'não foi possível usar'}`);
      }
    }
    setItems((current) => [...current, ...added].slice(0, POST_IMAGES_MAX));
    const extra = files.length - room;
    if (extra > 0) skipped.push(`Só cabem ${POST_IMAGES_MAX} fotos: ${extra} ficou de fora.`);
    if (skipped.length > 0) setMessage({ tone: 'error', text: skipped.join(' ') });
    setReading(false);
  }

  function addPlace(place: ExplorePlace) {
    setPicking(false);
    if (!place.photoPath) return;
    setItems((current) => [...current, { key: nextKey(), kind: 'PLACE', preview: api.assetUrl(place.photoPath as string), photoPath: place.photoPath as string, author: place.photoAuthor, placeName: place.name, placeAddress: place.address }].slice(0, POST_IMAGES_MAX));
  }

  async function publish() {
    setBusy(true);
    setMessage(undefined);
    try {
      const place = items.find((i): i is Extract<Item, { kind: 'PLACE' }> => i.kind === 'PLACE');
      const images: PostImageInput[] = items.map((i) => (i.kind === 'UPLOAD' ? i.dataUrl : { photoPath: i.photoPath, photoAuthor: i.author }));
      const created = await api.createPost({
        images,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(place ? { placeName: place.placeName, ...(place.placeAddress ? { placeAddress: place.placeAddress } : {}) } : {}),
      });
      navigate(`/posts/${encodeURIComponent(created.id)}`);
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Novo post" back="/" />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {items.length === 0 ? (
        <EmptyState title="Escolha as fotos do post">Envie de 1 a {POST_IMAGES_MAX} fotos ou use a foto de um lugar.</EmptyState>
      ) : (
        <ul className="composepics" aria-label="Fotos do post">
          {items.map((item, i) => (
            <li key={item.key} className="composepics__item">
              <img src={item.preview} alt={`Foto ${i + 1}`} referrerPolicy="no-referrer" />
              {i === 0 && items.length > 1 ? <span className="composepics__cover">Capa</span> : null}
              <button type="button" className="composepics__remove" onClick={() => setItems((current) => current.filter((x) => x.key !== item.key))} aria-label={`Remover foto ${i + 1}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileRef} type="file" accept="image/*" multiple className="visually-hidden" id="fotos-post" onChange={addFiles} />
      <div className="row-actions">
        <Button variant="secondary" loading={reading} disabled={room <= 0} onClick={() => fileRef.current?.click()}>
          {items.length === 0 ? 'Escolher fotos' : 'Adicionar fotos'}
        </Button>
        <Button variant="secondary" disabled={room <= 0 || hasPlace} onClick={() => setPicking(true)}>
          Foto de um lugar
        </Button>
      </div>
      <p className="muted">{items.length}/{POST_IMAGES_MAX} fotos. As fotos são reduzidas antes de enviar.</p>
      <Field label="Legenda (opcional)" value={caption} onChange={setCaption} multiline maxLength={POST_CAPTION_MAX + 20} hint={`${Array.from(caption).length}/${POST_CAPTION_MAX}`} />
      <div className="row-actions">
        <Button loading={busy} disabled={items.length === 0 || Array.from(caption).length > POST_CAPTION_MAX} onClick={publish}>
          Publicar
        </Button>
        <Link to="/" className="btn btn--quiet">
          Cancelar
        </Link>
      </div>
      {picking ? <PlacePhotoSheet onPick={addPlace} onClose={() => setPicking(false)} /> : null}
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
      <PostCard post={post.data} onDeleted={() => navigate('/perfil')} />
    </>
  );
}
