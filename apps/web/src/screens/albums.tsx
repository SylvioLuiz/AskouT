import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { useAlbumPhoto } from '../components/album-photo.tsx';
import { PhotoIcon } from '../components/icons.tsx';
import { AvatarViewer } from '../components/photo-viewer.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { albumName, albumPhotosText, albumWith } from '../lib/album.ts';
import { toApiError } from '../lib/errors.ts';
import { resizePostPhoto } from '../lib/image.ts';
import type { AlbumDetail, AlbumPhoto, AlbumSummary } from '../lib/types.ts';
import { POST_CAPTION_MAX } from '../lib/post-draft.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

const dayText = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

function Thumb({ albumId, photoId, onOpen }: { albumId: string; photoId: string; onOpen?: () => void }) {
  const { url, failed } = useAlbumPhoto(albumId, photoId);
  const face = url ? <img className="albumgrid__img" src={url} alt={t('Foto do álbum')} /> : <span className="albumgrid__img albumgrid__img--empty">{failed ? '!' : ''}</span>;
  return onOpen ? (
    <button type="button" className="albumgrid__item" onClick={onOpen} aria-label={t('Ver foto')}>
      {face}
    </button>
  ) : (
    <span className="albumgrid__item">{face}</span>
  );
}

/** Álbuns dos encontros de que a pessoa fez parte nos últimos 30 dias. */
export function AlbumsScreen() {
  useTitle(t('Álbuns dos encontros'));
  const list = useAsync(() => api.albums(), []);
  return (
    <>
      <PageHead title={t('Álbuns dos encontros')} back="/perfil" />
      <p className="muted">{t('Fotos do NOW e dos eventos aonde você foi. Só quem foi vê.')}</p>
      {list.loading && !list.data ? <Loading /> : null}
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState title={t('Nenhum álbum ainda')}>{t('Depois de um encontro do NOW ou de um evento em que você confirmou presença, o álbum aparece aqui.')}</EmptyState>
      ) : null}
      <ul className="albumlist">
        {(list.data?.items ?? []).map((album: AlbumSummary) => (
          <li key={album.id}>
            <Link to={`/albuns/${encodeURIComponent(album.id)}`} className="albumlist__item">
              <span className="albumlist__cover">{album.coverPhotoId ? <Thumb albumId={album.id} photoId={album.coverPhotoId} /> : <PhotoIcon />}</span>
              <span className="albumlist__text">
                <span className="albumlist__title">{albumName(album)}</span>
                <span className="albumlist__sub">
                  {dayText(album.startedAt)} · {albumWith(album.friendCount)} · {albumPhotosText(album.photoCount)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function PostSheet({ albumId, photo, onClose }: { albumId: string; photo: AlbumPhoto; onClose: () => void }) {
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.postAlbumPhoto(albumId, photo.id, caption);
      setDone(true);
    } catch (failure) {
      setError(toApiError(failure).message);
    }
    setBusy(false);
  }
  return (
    <Sheet title={t('Postar no meu perfil')} onClose={onClose}>
      {done ? (
        <>
          <Notice tone="ok">{t('Pronto! A foto está no seu perfil.')}</Notice>
          <Button full onClick={onClose}>
            {t('Fechar')}
          </Button>
        </>
      ) : (
        <>
          <p className="muted">{t('A foto vira um post no seu perfil, visível para quem pode ver os seus posts.')}</p>
          <Field label={t('Legenda (opcional)')} value={caption} onChange={setCaption} multiline maxLength={POST_CAPTION_MAX} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button full loading={busy} onClick={() => void submit()}>
            {t('Publicar')}
          </Button>
        </>
      )}
    </Sheet>
  );
}

/** Menu da própria foto: postar no perfil ou apagar do álbum. */
function MyPhotoSheet({ album, photo, onClose, onView, onDeleted }: { album: AlbumDetail; photo: AlbumPhoto; onClose: () => void; onView: () => void; onDeleted: () => void }) {
  const [posting, setPosting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  if (posting) return <PostSheet albumId={album.id} photo={photo} onClose={onClose} />;
  async function remove() {
    setBusy(true);
    try {
      await api.deleteAlbumPhoto(album.id, photo.id);
      onDeleted();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(false);
      setAsking(false);
    }
  }
  return (
    <Sheet title={t('Sua foto')} onClose={onClose}>
      <ul className="menulist">
        <li>
          <button type="button" className="menulist__item" onClick={onView}>
            <span>{t('Ver foto')}</span>
          </button>
        </li>
        <li>
          <button type="button" className="menulist__item" onClick={() => setPosting(true)}>
            <span>{t('Postar no meu perfil')}</span>
          </button>
        </li>
        <li>
          <button type="button" className="menulist__item menulist__item--danger" onClick={() => setAsking(true)}>
            <span>{t('Apagar do álbum')}</span>
          </button>
        </li>
      </ul>
      {asking ? <Confirm danger question={t('Apagar esta foto do álbum? Ela some para todos que veem o álbum e não dá para desfazer.')} confirmLabel={t('Apagar')} busy={busy} onConfirm={() => void remove()} onCancel={() => setAsking(false)} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Sheet>
  );
}

function ViewOnly({ albumId, photoId, onClose }: { albumId: string; photoId: string; onClose: () => void }) {
  const { url } = useAlbumPhoto(albumId, photoId);
  return url ? <AvatarViewer url={url} onClose={onClose} /> : null;
}

export function AlbumScreen({ albumId }: { albumId: string }) {
  const album = useAsync(() => api.album(albumId), [albumId]);
  useTitle(album.data ? albumName(album.data) : t('Álbum'));
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [mine, setMine] = useState<AlbumPhoto | undefined>();
  const [viewing, setViewing] = useState<string | undefined>();

  if (album.loading && !album.data) return <Loading />;
  if (album.error) {
    return album.error.code === 'NOT_FOUND' ? (
      <EmptyState
        title={t('Álbum não encontrado')}
        action={
          <Link to="/albuns" className="btn btn--secondary">
            {t('Ver meus álbuns')}
          </Link>
        }
      >
        {t('Só quem foi ao encontro vê o álbum.')}
      </EmptyState>
    ) : (
      <ErrorState message={album.error.message} onRetry={album.reload} />
    );
  }
  const data = album.data;
  if (!data) return null;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      for (const file of files) await api.addAlbumPhoto(albumId, await resizePostPhoto(file));
      album.reload();
    } catch (failure) {
      setError(failure instanceof Error && !('code' in failure) ? failure.message : toApiError(failure).message);
    }
    setBusy(false);
  }

  return (
    <>
      <PageHead title={albumName(data)} subtitle={`${dayText(data.startedAt)} · ${albumWith(data.friendCount)}`} back="/albuns" />
      <div className="albumpeople">
        {data.members.map((m) => (
          <Link key={m.userId} to={`/u/${encodeURIComponent(m.username)}`} aria-label={m.username}>
            <Avatar profile={m} size={36} />
          </Link>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="visually-hidden" aria-label={t('Adicionar fotos')} tabIndex={-1} onChange={(e) => void pick(e)} />
      <Button full loading={busy} onClick={() => fileRef.current?.click()}>
        {t('Adicionar fotos')}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data.photos.length === 0 ? (
        <EmptyState title={t('Nenhuma foto ainda')}>{t('Seja o primeiro a adicionar uma foto do encontro.')}</EmptyState>
      ) : (
        <div className="albumgrid">
          {data.photos.map((photo) => (
            <Thumb key={photo.id} albumId={data.id} photoId={photo.id} onOpen={() => (photo.mine ? setMine(photo) : setViewing(photo.id))} />
          ))}
        </div>
      )}
      {mine ? (
        <MyPhotoSheet
          album={data}
          photo={mine}
          onClose={() => setMine(undefined)}
          onView={() => {
            setViewing(mine.id);
            setMine(undefined);
          }}
          onDeleted={() => {
            setMine(undefined);
            album.reload();
          }}
        />
      ) : null}
      {viewing ? <ViewOnly albumId={data.id} photoId={viewing} onClose={() => setViewing(undefined)} /> : null}
    </>
  );
}
