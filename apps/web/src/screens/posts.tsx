import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CarouselIcon, ChevronLeftIcon, ChevronRightIcon, CropIcon, LocationIcon, PhotoIcon, UsersIcon, XIcon } from '../components/icons.tsx';
import { FriendPicker } from '../components/meetup.tsx';
import { ConversationPick } from '../components/conversation-pick.tsx';
import { CropEditor } from '../components/crop.tsx';
import { EventDates } from '../components/event-dates.tsx';
import { EventKindPicker } from '../components/event-kind-picker.tsx';
import { PostCard, PostList } from '../components/post.tsx';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { cropPostPhoto, readPostSource, resizePostPhoto } from '../lib/image.ts';
import type { CropRect } from '../lib/crop.ts';
import { toggleId } from '../lib/meetup.ts';
import { addImages, buildPostBody, effectivePlace, eventProblem, videoOf, POST_CAPTION_MAX, POST_IMAGES_MAX } from '../lib/post-draft.ts';
import { isVideoFile, POST_VIDEO_MAX_BYTES, uploadProgressText, videoPoster, videoProblem, VIDEO_STILL_TOO_BIG } from '../lib/post-video.ts';
import { canCompressVideo, prepareProgressText, prepareVideo } from '../lib/video-prepare.ts';
import type { DraftImage, LinkedPlace } from '../lib/post-draft.ts';
import type { EventKind, ExplorePlace } from '../lib/types.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { t } from '../lib/i18n/index.ts';

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
  return status === 'denied' || status === 'unavailable' ? <Notice tone="error">{t('Para achar rolês perto de você, permita a localização no navegador.')}</Notice> : null;
}

/** Escolher o lugar a vincular ao post (qualquer lugar, com ou sem foto). */
function LinkPlaceSheet({ onPick, onClose }: { onPick: (place: LinkedPlace) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const { term, where, result, places } = usePlaceSearch(q, false);
  return (
    <Sheet title={t('Vincular um rolê')} onClose={onClose}>
      <Field label={t('Buscar rolê')} type="search" value={q} onChange={setQ} autoFocus autoComplete="off" hint={t('Ex.: bar, balada, show')} />
      <LocationNotice status={where.status} />
      {term.length < 2 ? <p className="muted">{t('Digite o nome ou o tipo do rolê.')}</p> : null}
      {result.loading && !result.data ? <Loading /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && !result.data.placesAvailable ? <Notice>{t('A busca de rolês ainda não está ligada neste ambiente.')}</Notice> : null}
      {result.data && result.data.placesAvailable && places.length === 0 ? <p className="muted">{t('Nenhum rolê encontrado.')}</p> : null}
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
      <Field label={t('Buscar rolê')} type="search" value={q} onChange={setQ} autoComplete="off" hint={t('Ex.: bar, balada, show')} />
      <LocationNotice status={where.status} />
      {term.length < 2 ? <p className="muted">{t('Digite o nome ou o tipo do rolê para ver as fotos.')}</p> : null}
      {result.loading && !result.data ? <Loading /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && !result.data.placesAvailable ? <Notice>{t('A busca de rolês com foto ainda não está ligada neste ambiente.')}</Notice> : null}
      {result.data && result.data.placesAvailable && places.length === 0 ? <p className="muted">{t('Nenhum rolê com foto para essa busca.')}</p> : null}
      <ul className="placegrid" aria-label={t('Fotos de rolês')}>
        {places.map((p) => (
          <li key={p.key}>
            <button type="button" className="placegrid__item" aria-pressed={picked === p.name} onClick={() => onPick(p)}>
              <img src={api.assetUrl(p.photoPath as string)} alt="" referrerPolicy="no-referrer" />
              <span className="placegrid__name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">{t('Fotos de rolês são do Google, com o crédito de quem tirou.')}</p>
    </>
  );
}

type Step = 'photos' | 'details';
type Source = 'photos' | 'place';

export function CreatePostScreen() {
  const prefill = useSearch();
  const startAsEvent = prefill.get('votacao') !== null || prefill.get('tipo') === 'evento';
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('photos');
  const [source, setSource] = useState<Source>('photos');
  const [items, setItems] = useState<DraftImage[]>([]);
  const [focusKey, setFocusKey] = useState<string | undefined>();
  const [caption, setCaption] = useState('');
  const [linked, setLinked] = useState<LinkedPlace | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ sent: number; total: number } | undefined>();
  const [prep, setPrep] = useState<{ progress: number } | undefined>();
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [linking, setLinking] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [cropKey, setCropKey] = useState<string | undefined>();
  const [cropBusy, setCropBusy] = useState(false);
  // Vindo de uma votação de data fechada: já abre como evento, com nome, horário e a conversa marcada.
  const fromPoll = prefill.get('votacao') !== null;
  // `?tipo=evento` (ou vindo de uma votação) já abre como evento.
  const [kind, setKind] = useState<'POST' | 'EVENT'>(startAsEvent ? 'EVENT' : 'POST');
  const [eventTitle, setEventTitle] = useState(fromPoll ? (prefill.get('titulo') ?? '').slice(0, 120) : '');
  const [eventKind, setEventKind] = useState<EventKind>('OTHER');
  const [eventStart, setEventStart] = useState(fromPoll ? (prefill.get('inicio') ?? '') : '');
  const [eventEnd, setEventEnd] = useState(fromPoll ? (prefill.get('fim') ?? '') : '');
  const [eventPrivate, setEventPrivate] = useState(false);
  const [shareTo, setShareTo] = useState<string[]>(fromPoll && prefill.get('conversa') ? [prefill.get('conversa') as string] : []);
  useTitle(kind === 'EVENT' ? t('Novo evento') : t('Nova publicação'));
  const [createdId, setCreatedId] = useState<string | undefined>();
  const [discarding, setDiscarding] = useState(false);
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
    let hasVideo = videoOf(items) !== undefined;
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        if (isVideoFile(file)) {
          if (hasVideo) throw new Error(t('Só cabe um vídeo por publicação.'));
          // Passou de 60 MB? Só serve se este aparelho conseguir reduzir antes de enviar.
          const problem = videoProblem(file, { canCompress: file.size > POST_VIDEO_MAX_BYTES ? await canCompressVideo() : false });
          if (problem) throw new Error(problem);
          const { poster } = await videoPoster(file);
          added.push({ key: nextKey(), kind: 'UPLOAD', preview: poster, dataUrl: poster, video: file });
          hasVideo = true;
          continue;
        }
        const dataUrl = await resizePostPhoto(file);
        const source = await readPostSource(file).catch(() => undefined);
        added.push({ key: nextKey(), kind: 'UPLOAD', preview: dataUrl, dataUrl, ...(source ? { source } : {}) });
      } catch (failure) {
        skipped.push(`${file.name}: ${failure instanceof Error ? failure.message : t('não foi possível usar')}`);
      }
    }
    setItems((current) => addImages(current, added));
    if (added[0]) setFocusKey(added[0].key);
    const extra = files.length - Math.max(room, 0);
    if (extra > 0) skipped.push(t('Só cabem {POST_IMAGES_MAX} itens: {extra} ficou de fora.', { POST_IMAGES_MAX, extra }));
    if (skipped.length > 0) setMessage({ tone: 'error', text: skipped.join(' ') });
    setReading(false);
  }

  function pickPlacePhoto(p: ExplorePlace) {
    if (!p.photoPath) return;
    const image: DraftImage = { key: nextKey(), kind: 'PLACE', preview: api.assetUrl(p.photoPath), photoPath: p.photoPath, author: p.photoAuthor, placeName: p.name, placeAddress: p.address };
    const next = addImages(items, [image]);
    if (!next.includes(image)) {
      setMessage({ tone: 'error', text: t('Já são {POST_IMAGES_MAX} fotos. Remova uma para usar a foto do rolê.', { POST_IMAGES_MAX }) });
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
      setMessage({ tone: 'error', text: failure instanceof Error ? failure.message : t('Não foi possível recortar a foto.') });
    } finally {
      setCropBusy(false);
    }
  }

  function remove(key: string) {
    setItems((current) => current.filter((i) => i.key !== key));
    setMessage(undefined);
  }

  async function publish() {
    if (createdId) return navigate(`/eventos/${encodeURIComponent(createdId)}`);
    setBusy(true);
    setMessage(undefined);
    const eventDraft = kind === 'EVENT' ? { title: eventTitle, kind: eventKind, startsAt: eventStart, endsAt: eventEnd, private: eventPrivate } : null;
    const problem = eventDraft ? eventProblem(eventDraft, effectivePlace(items, linked), new Date()) : null;
    if (problem) {
      setMessage({ tone: 'error', text: problem });
      setBusy(false);
      return;
    }
    try {
      // O vídeo é otimizado ANTES de criar o post: se não der para reduzir, nada fica pela metade no servidor.
      const draftVideo = videoOf(items);
      let videoFile: File | undefined;
      if (draftVideo) {
        setPrep({ progress: 0 });
        const prepared = await prepareVideo(draftVideo.file, { onProgress: (progress) => setPrep({ progress }) });
        setPrep(undefined);
        if (prepared.file.size > POST_VIDEO_MAX_BYTES) throw new Error(VIDEO_STILL_TOO_BIG);
        videoFile = prepared.file;
      }
      const created = await api.createPost(buildPostBody(items, caption, linked, tags, eventDraft, prefill.get('votacao')));
      const video = draftVideo && videoFile ? { ...draftVideo, file: videoFile } : undefined;
      if (video) {
        // O vídeo segue logo depois do post, no item da capa. Se falhar, o post não fica pela metade (só com a capa).
        const target = created.images[video.index];
        try {
          if (!target) throw new Error(t('Não foi possível anexar o vídeo.'));
          setUpload({ sent: 0, total: video.file.size });
          await api.attachPostVideo(created.id, target.id, video.file, (sent, total) => setUpload({ sent, total }));
        } catch (failure) {
          await api.deletePost(created.id).catch(() => undefined);
          throw failure;
        }
      }
      if (created.event && shareTo.length > 0) {
        const results = await Promise.allSettled(shareTo.map((conversationId) => api.sendEvent(conversationId, created.id)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          setCreatedId(created.id);
          setMessage({ tone: 'error', text: failed === 1 ? t('O evento foi criado, mas não consegui enviar para 1 conversa. Abra o evento e use Compartilhar.') : t('O evento foi criado, mas não consegui enviar para {count} conversas. Abra o evento e use Compartilhar.', { count: failed }) });
          setBusy(false);
          return;
        }
      }
      setUpload(undefined);
      navigate(created.event ? (eventPrivate ? `/eventos/${encodeURIComponent(created.id)}` : '/perfil?aba=eventos') : `/posts/${encodeURIComponent(created.id)}`);
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
      setUpload(undefined);
      setPrep(undefined);
      setBusy(false);
    }
  }

  const kindToggle = (
    <div className="segmented" role="group" aria-label={t('Tipo de publicação')}>
      <button type="button" className={`segmented__tab${kind === 'POST' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'POST'} onClick={() => setKind('POST')} disabled={busy}>
        {t('Post')}
      </button>
      <button type="button" className={`segmented__tab${kind === 'EVENT' ? ' segmented__tab--on' : ''}`} aria-pressed={kind === 'EVENT'} onClick={() => setKind('EVENT')} disabled={busy}>
        {t('Evento')}
      </button>
    </div>
  );

  const fileInput = <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="visually-hidden" aria-label={t('Escolher fotos ou vídeo')} id="fotos-post" onChange={addFiles} />;

  const captionLength = Array.from(caption).length;
  const cover = items[0];

  function leave() {
    if (items.length === 0 && caption.trim() === '') navigate('/');
    else setDiscarding(true);
  }

  const discardSheet = discarding ? (
    <Sheet title={t('Descartar publicação?')} onClose={() => setDiscarding(false)}>
      <p className="muted">{t('Se sair agora, as fotos e o texto que você escolheu não serão salvos.')}</p>
      <Button variant="danger" full onClick={() => navigate('/')}>
        {t('Descartar')}
      </Button>
      <Button variant="quiet" full onClick={() => setDiscarding(false)}>
        {t('Continuar editando')}
      </Button>
    </Sheet>
  ) : null;

  if (step === 'details') {
    return (
      <div className="compose compose--details">
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={() => setStep('photos')} aria-label={t('Voltar para as fotos')} disabled={busy}>
            <ChevronLeftIcon />
          </button>
          <h1 className="compose__title">{kind === 'EVENT' ? t('Novo evento') : t('Nova publicação')}</h1>
          <span aria-hidden="true" />
        </header>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {busy && prep ? (
          <div className="uploadbar" role="status" aria-live="polite">
            <progress className="uploadbar__bar" max={1} value={prep.progress} aria-label={t('Otimização do vídeo')} />
            <p className="uploadbar__text">{prepareProgressText(prep.progress)}</p>
            <p className="uploadbar__hint">{t('Estamos reduzindo o vídeo para o envio ser mais rápido. Mantenha esta tela aberta.')}</p>
          </div>
        ) : null}
        {busy && upload ? (
          <div className="uploadbar" role="status" aria-live="polite">
            <progress className="uploadbar__bar" max={upload.total} value={upload.sent} aria-label={t('Envio do vídeo')} />
            <p className="uploadbar__text">{uploadProgressText(upload.sent, upload.total)}</p>
            <p className="uploadbar__hint">{t('Mantenha esta tela aberta até terminar.')}</p>
          </div>
        ) : null}
        {kindToggle}
        {kind === 'EVENT' ? (
          <section className="compose__row" aria-label={t('Dados do evento')}>
            <Field label={t('Nome do evento')} value={eventTitle} onChange={setEventTitle} maxLength={120} />
            <EventKindPicker value={eventKind} onChange={setEventKind} />
            <EventDates starts={eventStart} ends={eventEnd} onStarts={setEventStart} onEnds={setEventEnd} />
            <p className="muted">{t('O rolê é opcional: escolha abaixo se quiser.')}</p>
            <label className="check">
              <input type="checkbox" checked={eventPrivate} onChange={(e) => setEventPrivate(e.target.checked)} />
              <span>
                <strong>{t('Evento privado')}</strong>
                <span className="muted">{t('Não aparece no seu perfil nem no feed, e ninguém o posta no próprio perfil. Só chega a quem receber nas conversas.')}</span>
              </span>
            </label>
            <h3 className="compose__h">{t('Enviar para conversas e grupos')}</h3>
            <ConversationPick selected={shareTo} onChange={setShareTo} label={t('Conversas que vão receber o evento')} />
            <p className="muted">{eventPrivate ? t('Escolha com quem compartilhar.') : t('Opcional. Quem estiver no grupo poderá postar o evento no próprio perfil.')}</p>
          </section>
        ) : null}
        <div className="compose__caption">
          <button type="button" className="compose__thumb" onClick={() => setStep('photos')} disabled={busy} aria-label={t('Editar fotos ({count})', { count: items.length })}>
            {cover ? <img src={cover.preview} alt="" referrerPolicy="no-referrer" /> : null}
            {items.length > 1 ? (
              <span className="compose__thumbicon" aria-hidden="true">
                <CarouselIcon />
              </span>
            ) : null}
            {cover && cover.kind === 'UPLOAD' && cover.video ? <span className="compose__thumbplay" aria-hidden="true">▶</span> : null}
          </button>
          <textarea
            className="compose__text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={kind === 'EVENT' ? t('Conte mais sobre o evento…') : t('Escreva uma legenda…')}
            aria-label={t('Legenda')}
            maxLength={POST_CAPTION_MAX + 20}
            rows={4}
            aria-invalid={captionLength > POST_CAPTION_MAX || undefined}
          />
        </div>
        {captionLength > POST_CAPTION_MAX * 0.8 ? (
          <p className={`compose__count${captionLength > POST_CAPTION_MAX ? ' compose__count--over' : ''}`} aria-live="polite">
            {captionLength}/{POST_CAPTION_MAX}
          </p>
        ) : null}
        <ul className="optrows">
          <li className="optrow">
            {placeFromPhoto ? (
              <div className="optrow__main">
                <span className="optrow__icon"><LocationIcon /></span>
                <span className="optrow__text">
                  <span className="optrow__label">{place?.name}</span>
                  <span className="optrow__sub">{t('O rolê vem da foto do rolê que você escolheu.')}</span>
                </span>
              </div>
            ) : (
              <button type="button" className="optrow__main" onClick={() => setLinking(true)}>
                <span className="optrow__icon"><LocationIcon /></span>
                <span className="optrow__text">
                  <span className="optrow__label">{place ? place.name : t('Vincular um rolê')}</span>
                  {place?.address ? <span className="optrow__sub">{place.address}</span> : null}
                </span>
                {linked ? null : <span className="optrow__chev"><ChevronRightIcon /></span>}
              </button>
            )}
            {linked && !placeFromPhoto ? (
              <button type="button" className="optrow__clear" onClick={() => setLinked(null)} aria-label={t('Remover o rolê vinculado')}>
                <XIcon />
              </button>
            ) : null}
          </li>
          <li className="optrow">
            <button type="button" className="optrow__main" onClick={() => setTagging(true)}>
              <span className="optrow__icon"><UsersIcon /></span>
              <span className="optrow__text">
                <span className="optrow__label">{t('Marcar pessoas')}</span>
                {tagged.length > 0 ? <span className="optrow__sub">{tagged.map((f) => `@${f.username}`).join(', ')}</span> : null}
              </span>
              {tagged.length > 0 ? (
                <span className="optrow__avatars" aria-hidden="true">
                  {tagged.slice(0, 3).map((f) => (
                    <Avatar key={f.userId} profile={f} size={24} />
                  ))}
                </span>
              ) : null}
              <span className="optrow__chev"><ChevronRightIcon /></span>
            </button>
          </li>
        </ul>

        <div className="compose__footer">
          <Button full loading={busy} disabled={captionLength > POST_CAPTION_MAX} onClick={() => void publish()}>
            {createdId ? t('Abrir o evento criado') : kind === 'EVENT' ? t('Criar evento') : t('Compartilhar')}
          </Button>
        </div>

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
          <Sheet title={t('Marcar pessoas')} onClose={() => setTagging(false)}>
            <p className="muted">{t('Só amigos. Cada pessoa precisa aceitar a marcação para o post aparecer no perfil e no feed dela.')}</p>
            <FriendPicker picked={tags} onToggle={(id) => setTags((c) => toggleId(c, id))} />
            <Button full onClick={() => setTagging(false)}>
              {t('Concluir')}
            </Button>
          </Sheet>
        ) : null}
      </div>
    );
  }

  return (
    <div className="compose">
      <header className="compose__bar">
        <button type="button" className="iconbtn" onClick={leave} aria-label={t('Cancelar')}>
          <XIcon />
        </button>
        <h1 className="compose__title">{kind === 'EVENT' ? t('Novo evento') : t('Nova publicação')}</h1>
        <button type="button" className="compose__next" disabled={items.length === 0 || reading || cropKey !== undefined} onClick={() => setStep('details')}>
          {t('Avançar')}
        </button>
      </header>
      {fileInput}

      {kindToggle}

      <div className="segmented" role="tablist" aria-label={t('De onde vem a foto')}>
        <button type="button" role="tab" aria-selected={source === 'photos'} className={`segmented__tab${source === 'photos' ? ' segmented__tab--on' : ''}`} onClick={() => setSource('photos')}>
          {t('Escolher fotos')}
        </button>
        <button type="button" role="tab" aria-selected={source === 'place'} className={`segmented__tab${source === 'place' ? ' segmented__tab--on' : ''}`} onClick={() => setSource('place')}>
          {t('Foto de um rolê')}
        </button>
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {cropKey && focused && focused.key === cropKey && focused.kind === 'UPLOAD' && focused.source ? (
        <CropEditor source={focused.source} initial={focused.crop} busy={cropBusy} onApply={(rect) => void applyCrop(focused.key, rect)} onCancel={() => setCropKey(undefined)} />
      ) : (
      <div className="compose__stage">
        {focused ? (
          <>
            <img src={focused.preview} alt={focused.kind === 'UPLOAD' && focused.video ? t('Capa do vídeo') : t('Foto em destaque')} referrerPolicy="no-referrer" />
            {focused.kind === 'UPLOAD' && focused.video ? <span className="stage__video" aria-label={t('Vídeo')}>▶ Vídeo</span> : null}
          </>
        ) : source === 'photos' ? (
          <div className="compose__empty">
            <span className="compose__emptyicon" aria-hidden="true">
              <PhotoIcon />
            </span>
            <p className="compose__emptytitle">{reading ? t('Preparando as fotos…') : kind === 'EVENT' ? t('Capa do evento') : t('Fotos e vídeos do rolê')}</p>
            <p className="compose__emptyhint">{kind === 'EVENT' ? t('Escolha a capa e avance para dar nome, data e horário ao evento.') : t('Até {max} itens, com no máximo 1 vídeo.', { max: POST_IMAGES_MAX })}</p>
            <Button small loading={reading} onClick={() => fileRef.current?.click()}>
              {t('Escolher da galeria')}
            </Button>
          </div>
        ) : (
          <div className="compose__empty">
            <span className="compose__emptyicon" aria-hidden="true">
              <LocationIcon />
            </span>
            <p className="compose__emptyhint">{t('Busque um rolê abaixo para usar a foto dele.')}</p>
          </div>
        )}
        {items.length > 0 ? <span className="stage__count">{items.findIndex((i) => i.key === focused?.key) + 1}/{items.length}</span> : null}
        {focused && focused.kind === 'UPLOAD' && focused.source ? (
          <button type="button" className="stage__crop" onClick={() => setCropKey(focused.key)} aria-label={t('Recortar foto')} title={t('Recortar')}>
            <CropIcon />
          </button>
        ) : null}
      </div>
      )}

      {items.length > 0 ? (
        <ul className="composegrid" aria-label={t('Fotos escolhidas')}>
          {items.map((item, i) => (
            <li key={item.key} className={`composegrid__item${item.key === focused?.key ? ' composegrid__item--on' : ''}`}>
              <button type="button" className="composegrid__pick" onClick={() => { if (cropKey === undefined) setFocusKey(item.key); }} disabled={cropKey !== undefined && item.key !== cropKey} aria-label={t('Ver item {i}', { i: i + 1 })} aria-pressed={item.key === focused?.key}>
                <img src={item.preview} alt="" referrerPolicy="no-referrer" />
                {item.kind === 'UPLOAD' && item.video ? <span className="composegrid__video" aria-hidden="true">▶</span> : null}
                <span className="composegrid__n">{i + 1}</span>
              </button>
              <button type="button" className="composegrid__remove" onClick={() => remove(item.key)} aria-label={t('Remover foto {i}', { i: i + 1 })}>
                ×
              </button>
            </li>
          ))}
          {source === 'photos' && room > 0 ? (
            <li className="composegrid__item">
              <button type="button" className="composegrid__add" onClick={() => fileRef.current?.click()} disabled={reading} aria-label={t('Adicionar fotos')}>
                +
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {items.length > 0 ? <p className="compose__meta">{t('{count} de {max} · toque para ver, × para tirar', { count: items.length, max: POST_IMAGES_MAX })}</p> : null}

      {source === 'place' ? <PlacePhotoGrid picked={placePhoto?.placeName} onPick={pickPlacePhoto} /> : null}
      {discardSheet}
    </div>
  );
}

/** Posts que você arquivou: só você vê. Pelo menu ⋯ do post dá para desarquivar. */
export function ArchivedScreen() {
  useTitle(t('Arquivados'));
  return (
    <>
      <PageHead title={t('Arquivados')} back="/perfil" />
      <p className="muted">{t('Posts que você arquivou ficam fora do feed e do seu perfil. Só você vê.')}</p>
      <PostList load={(offset) => api.archivedPosts({ limit: 12, offset })} emptyTitle={t('Nada arquivado')} emptyHint={t('Use o menu ⋯ de um post seu e escolha Arquivar.')} />
    </>
  );
}

export function PostScreen({ postId }: { postId: string }) {
  useTitle(t('Post'));
  const post = useAsync(() => api.post(postId), [postId]);
  if (post.loading && !post.data) return <Loading />;
  if (post.error) {
    return post.error.code === 'NOT_FOUND' ? (
      <EmptyState
        title={t('Post não encontrado')}
        action={
          <Link to="/" className="btn btn--secondary">
            {t('Ir para a Home')}
          </Link>
        }
      >
        {t('Ele foi apagado ou você não pode vê-lo.')}
      </EmptyState>
    ) : (
      <ErrorState message={post.error.message} onRetry={post.reload} />
    );
  }
  if (!post.data) return null;
  return (
    <>
      <PageHead title={t('Post')} back={`/u/${encodeURIComponent(post.data.author.username)}`} />
      <PostCard poster post={post.data} onGone={(_id, why) => navigate(why === 'hidden' ? '/' : '/perfil')} />
    </>
  );
}
