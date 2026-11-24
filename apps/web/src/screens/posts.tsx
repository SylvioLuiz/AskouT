import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CalendarIcon, CarouselIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CropIcon, EventKindIcon, GlobeIcon, LocationIcon, LockIcon, PhotoIcon, PlusIcon, ShareIcon, UsersIcon, XIcon } from '../components/icons.tsx';
import { EventAudienceSheet, EventKindSheet, EventRow, EventWhenSheet } from '../components/event-compose.tsx';
import { FriendPicker } from '../components/meetup.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { CropEditor } from '../components/crop.tsx';
import { EventDates } from '../components/event-dates.tsx';
import { EventKindPicker } from '../components/event-kind-picker.tsx';
import { EventExtrasFields } from '../components/event-extras.tsx';
import { extrasFromDraft } from '../lib/event-extras.ts';
import { whenLabel } from '../lib/event-when.ts';
import { KINDS } from '../lib/explore.ts';
import type { EventExtrasDraft } from '../lib/event-extras.ts';
import { PostCard, PostList } from '../components/post.tsx';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { ApiError, toApiError } from '../lib/errors.ts';
import { cropPostPhoto, readPostSource, resizePostPhoto } from '../lib/image.ts';
import type { CropRect } from '../lib/crop.ts';
import { toggleId } from '../lib/meetup.ts';
import { addImages, buildPostBody, effectivePlace, eventProblem, postProblem, videoOf, POST_CAPTION_MAX, POST_IMAGES_MAX } from '../lib/post-draft.ts';
import { withMediaType } from '../lib/media-file.ts';
import { formatWhen } from '../lib/chat.ts';
import { isVideoFile, POST_VIDEO_MAX_BYTES, uploadProgressText, videoPoster, videoProblem, VIDEO_STILL_TOO_BIG } from '../lib/post-video.ts';
import { canCompressVideo, prepareProgressText, prepareVideo } from '../lib/video-prepare.ts';
import type { DraftImage, LinkedEvent, LinkedPlace } from '../lib/post-draft.ts';
import type { EventKind, ExplorePlace } from '../lib/types.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { LinkPlaceSheet } from '../components/link-place-sheet.tsx';
import { t } from '../lib/i18n/index.ts';
import { PostPageSkeleton } from '../components/skeletons.tsx';

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
  return status === 'denied' || status === 'unavailable' ? <Notice tone="error">{t('Para achar locais perto de você, permita a localização no navegador.')}</Notice> : null;
}

/** Eventos para vincular ao post: os que você confirmou presença ou criou, inclusive os que acabaram nos últimos 7 dias. */
function LinkEventSheet({ onPick, onClose }: { onPick: (event: LinkedEvent) => void; onClose: () => void }) {
  const going = useAsync(() => api.myGoingEvents(7), []);
  const items = going.data?.items ?? [];
  return (
    <Sheet title={t('Vincular um evento')} onClose={onClose}>
      <p className="muted">{t('Eventos em que você confirmou presença ou que criou. Para outro evento, abra a página dele e toque em Publicar sobre o evento.')}</p>
      {going.loading && !going.data ? <Loading shape="rows" rows={3} /> : null}
      {going.error ? <ErrorState message={going.error.message} onRetry={going.reload} /> : null}
      {going.data && items.length === 0 ? <p className="muted">{t('Nenhum evento por aqui ainda. Confirme presença em um evento ou vincule um local.')}</p> : null}
      <ul className="placepick">
        {items.map((e) => (
          <li key={e.id}>
            <button type="button" className="placepick__item" onClick={() => onPick({ id: e.id, title: e.title })}>
              <span>
                <strong>{e.title}</strong>
                <span className="muted"> {formatWhen(e.startsAt, e.endsAt, new Date())}{e.venueName ? ` · ${e.venueName}` : ''}</span>
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
      <Field label={t('Buscar local')} type="search" value={q} onChange={setQ} autoComplete="off" hint={t('Ex.: bar, balada, show')} />
      <LocationNotice status={where.status} />
      {term.length < 2 ? <p className="muted">{t('Digite o nome ou o tipo do local para ver as fotos.')}</p> : null}
      {result.loading && !result.data ? <Loading shape="grid" rows={6} /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && !result.data.placesAvailable ? <Notice>{t('A busca de locais com foto ainda não está ligada neste ambiente.')}</Notice> : null}
      {result.data && result.data.placesAvailable && places.length === 0 ? <p className="muted">{t('Nenhum local com foto para essa busca.')}</p> : null}
      <ul className="placegrid" aria-label={t('Fotos de locais')}>
        {places.map((p) => (
          <li key={p.key}>
            <button type="button" className="placegrid__item" aria-pressed={picked === p.name} onClick={() => onPick(p)}>
              <img src={api.assetUrl(p.photoPath as string)} alt="" referrerPolicy="no-referrer" />
              <span className="placegrid__name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">{t('Fotos de locais são do Google, com o crédito de quem tirou.')}</p>
    </>
  );
}

type Step = 'photos' | 'details';
type Source = 'photos' | 'place';

export function CreatePostScreen() {
  const prefill = useSearch();
  const startAsEvent = prefill.get('votacao') !== null || prefill.get('tipo') === 'evento';
  const fileRef = useRef<HTMLInputElement>(null);
  // Evento e post abrem direto na tela única. No post, foto é opcional: texto, fotos e o evento ou rolê ficam na mesma tela;
  // a tela de fotos só abre para editar (ordem, recorte, foto de um rolê).
  const [step, setStep] = useState<Step>('details');
  const [source, setSource] = useState<Source>('photos');
  const [items, setItems] = useState<DraftImage[]>([]);
  const [focusKey, setFocusKey] = useState<string | undefined>();
  const [caption, setCaption] = useState('');
  const [linked, setLinked] = useState<LinkedPlace | null>(null);
  // Post comum precisa de um evento ou de um rolê. Vindo da página do evento (`?evento=id&eventoNome=...`), já vem marcado.
  const [linkedEvent, setLinkedEvent] = useState<LinkedEvent | null>(() => {
    const id = prefill.get('evento');
    return id ? { id, title: (prefill.get('eventoNome') ?? t('Evento')).slice(0, 120) } : null;
  });
  const [pickingEvent, setPickingEvent] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ sent: number; total: number } | undefined>();
  // Otimização do vídeo: começa assim que o vídeo é escolhido, em segundo plano, enquanto a pessoa escreve a legenda.
  // Na hora de publicar, só espera o que faltar (antes começava do zero só depois de tocar em Compartilhar).
  const [prep, setPrep] = useState<{ key: string; progress: number; done: boolean } | undefined>();
  const videoJob = useRef<{ key: string; abort: AbortController; promise: Promise<File> } | undefined>(undefined);
  useEffect(() => () => videoJob.current?.abort.abort(), []);

  function startVideoJob(key: string, file: File, seconds: number) {
    videoJob.current?.abort.abort();
    const abort = new AbortController();
    setPrep({ key, progress: 0, done: false });
    const promise = prepareVideo(file, { seconds, signal: abort.signal, onProgress: (progress) => setPrep((p) => (p && p.key === key ? { ...p, progress } : p)) }).then((prepared) => {
      if (prepared.file.size > POST_VIDEO_MAX_BYTES) throw new Error(VIDEO_STILL_TOO_BIG);
      return prepared.file;
    });
    promise.then(
      () => setPrep((p) => (p && p.key === key ? { ...p, progress: 1, done: true } : p)),
      () => setPrep((p) => (p && p.key === key ? undefined : p)),
    );
    videoJob.current = { key, abort, promise };
  }

  function dropVideoJob(key: string) {
    if (videoJob.current?.key !== key) return;
    videoJob.current.abort.abort();
    videoJob.current = undefined;
    setPrep(undefined);
  }
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [linking, setLinking] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [cropKey, setCropKey] = useState<string | undefined>();
  const [cropBusy, setCropBusy] = useState(false);
  // Vindo de uma votação de data fechada: já abre como evento, com nome, horário e a conversa marcada.
  const fromPoll = prefill.get('votacao') !== null;
  // `?tipo=evento` (ou vindo de uma votação) já abre como evento.
  const kind: 'POST' | 'EVENT' = startAsEvent ? 'EVENT' : 'POST';
  const [eventTitle, setEventTitle] = useState(fromPoll ? (prefill.get('titulo') ?? '').slice(0, 120) : '');
  const [eventKind, setEventKind] = useState<EventKind>('OTHER');
  // Data e horário também vêm de um compromisso da agenda (`/criar?tipo=evento&inicio=...&fim=...`).
  const [eventStart, setEventStart] = useState(startAsEvent ? (prefill.get('inicio') ?? '') : '');
  const [eventEnd, setEventEnd] = useState(startAsEvent ? (prefill.get('fim') ?? '') : '');
  const [eventPrivate, setEventPrivate] = useState(false);
  // Data decidida depois, numa votação: o evento nasce sem data.
  const [eventDateByPoll, setEventDateByPoll] = useState(false);
  // Configurações de evento da gestão ("Pode fumar?", "Estacionamento"...), respondidas num acordeon recolhido.
  const [extras, setExtras] = useState<EventExtrasDraft>({});
  const extraOptions = useAsync(() => (kind === 'EVENT' ? api.eventExtras().then((r) => r.items) : Promise.resolve(null)), [kind === 'EVENT']);
  // A conversa da votação já vem marcada no passo de enviar, que aparece depois que o evento é criado.
  const pollConversation = fromPoll ? prefill.get('conversa') : null;
  // Evento criado: em vez de sair direto, mostra o passo "Enviar para conversas".
  const [created, setCreated] = useState<{ id: string; title: string; private: boolean; cover: string | undefined; dateByPoll: boolean; /** Marcados na criação: já são convidados. */ taggedCount: number } | undefined>();
  const [sharing, setSharing] = useState(false);
  const [sharingOutside, setSharingOutside] = useState(false);
  const [sharedOnce, setSharedOnce] = useState(false);
  useTitle(created ? t('Evento criado') : kind === 'EVENT' ? t('Novo evento') : t('Nova publicação'));
  const [discarding, setDiscarding] = useState(false);
  // Folhas da tela de evento.
  const [sheet, setSheet] = useState<'when' | 'kind' | 'audience' | 'placePhoto' | undefined>();
  const [moreOpen, setMoreOpen] = useState(false);
  const friends = useAsync(() => api.friends(), []);

  const room = POST_IMAGES_MAX - items.length;
  const focused = items.find((i) => i.key === focusKey) ?? items[0];
  const place = effectivePlace(items, linked);
  const placePhoto = items.find((i): i is Extract<DraftImage, { kind: 'PLACE' }> => i.kind === 'PLACE');
  const placeFromPhoto = placePhoto !== undefined;
  const tagged = (friends.data ?? []).filter((f) => tags.includes(f.userId));

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    // Tipo corrigido pela extensão (alguns aparelhos entregam o vídeo sem tipo).
    const files = Array.from(event.target.files ?? []).map(withMediaType);
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
          const { poster, seconds } = await videoPoster(file);
          const key = nextKey();
          added.push({ key, kind: 'UPLOAD', preview: poster, dataUrl: poster, video: file });
          startVideoJob(key, file, seconds);
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
    addPlaceImage({ key: nextKey(), kind: 'PLACE', preview: api.assetUrl(p.photoPath), photoPath: p.photoPath, author: p.photoAuthor, placeName: p.name, placeAddress: p.address });
  }

  /** No evento, a foto do lugar vira a capa (primeiro item); no post, entra no fim como antes. */
  function addPlaceImage(image: Extract<DraftImage, { kind: 'PLACE' }>): boolean {
    const next = addImages(items, [image]);
    if (!next.includes(image)) {
      setMessage({ tone: 'error', text: t('Já são {POST_IMAGES_MAX} fotos. Remova uma para usar a foto do local.', { POST_IMAGES_MAX }) });
      return false;
    }
    setItems(kind === 'EVENT' ? [image, ...next.filter((i) => i !== image)] : next);
    setFocusKey(image.key);
    setMessage(undefined);
    return true;
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
    dropVideoJob(key);
    setItems((current) => current.filter((i) => i.key !== key));
    setMessage(undefined);
  }

  async function publish() {
    setBusy(true);
    setMessage(undefined);
    const eventDraft = kind === 'EVENT' ? { title: eventTitle, kind: eventKind, startsAt: eventDateByPoll ? '' : eventStart, endsAt: eventDateByPoll ? '' : eventEnd, dateByPoll: eventDateByPoll, private: eventPrivate, extras: extrasFromDraft(extras, extraOptions.data ?? []) } : null;
    // Evento sem foto vale: a página e o cartaz usam a capa padrão do tipo de evento.
    const problem = eventDraft ? eventProblem(eventDraft, effectivePlace(items, linked), new Date()) : postProblem({ items: items.length, caption, place: effectivePlace(items, linked), event: linkedEvent });
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
        const key = items[draftVideo.index]?.key ?? '';
        // Normalmente já terminou (ou está quase) enquanto a pessoa preenchia o resto.
        if (videoJob.current?.key !== key) {
          const { seconds } = await videoPoster(draftVideo.file);
          startVideoJob(key, draftVideo.file, seconds);
        }
        videoFile = await videoJob.current!.promise;
      }
      const created = await api.createPost(buildPostBody(items, caption, linked, tags, eventDraft, prefill.get('votacao'), linkedEvent));
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
      setUpload(undefined);
      if (created.event) {
        // O evento já existe: agora (e só agora) vem o passo de enviar para conversas, que dá para pular.
        const byPoll = created.event.startsAt === null;
        setCreated({ id: created.id, title: created.event.title, private: eventPrivate, cover: items[0]?.preview, dateByPoll: byPoll, taggedCount: tags.length });
        // Data por votação: o próximo passo é escolher a conversa da votação; senão, enviar para conversas.
        // Data por votação: primeiro convida (a votação abre com todos os convidados); senão, enviar para conversas.
        setSharing(true);
        setBusy(false);
        return;
      }
      navigate(`/posts/${encodeURIComponent(created.id)}`);
    } catch (failure) {
      // Erro do aparelho (vídeo que não coube, por exemplo) tem texto próprio; o resto vem da API.
      setMessage({ tone: 'error', text: failure instanceof Error && !(failure instanceof ApiError) && failure.message ? failure.message : toApiError(failure).message });
      setUpload(undefined);
      setBusy(false);
    }
  }


  const fileInput = <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="visually-hidden" aria-label={t('Escolher fotos ou vídeo')} id="fotos-post" onChange={addFiles} />;

  const captionLength = Array.from(caption).length;
  const cover = items[0];

  function leave() {
    if (items.length === 0 && caption.trim() === '' && eventTitle.trim() === '') navigate('/');
    else setDiscarding(true);
  }

  const progressBars = (
    <>
      {busy && prep && !prep.done ? (
        <div className="uploadbar" role="status" aria-live="polite">
          <progress className="uploadbar__bar" max={1} value={prep.progress} aria-label={t('Otimização do vídeo')} />
          <p className="uploadbar__text">{prepareProgressText(prep.progress)}</p>
          <p className="uploadbar__hint">{t('Estamos reduzindo o vídeo para o envio ser mais rápido. Mantenha esta tela aberta.')}</p>
        </div>
      ) : null}
      {!busy && prep && !prep.done ? (
        <p className="muted compose__prep" role="status" aria-live="polite">
          {prepareProgressText(prep.progress)} {t('Pode continuar preenchendo enquanto isso.')}
        </p>
      ) : null}
      {busy && upload ? (
        <div className="uploadbar" role="status" aria-live="polite">
          <progress className="uploadbar__bar" max={upload.total} value={upload.sent} aria-label={t('Envio do vídeo')} />
          <p className="uploadbar__text">{uploadProgressText(upload.sent, upload.total)}</p>
          <p className="uploadbar__hint">{t('Mantenha esta tela aberta até terminar.')}</p>
        </div>
      ) : null}
    </>
  );

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

  if (created) {
    const eventPath = `/eventos/${encodeURIComponent(created.id)}`;
    const pollPath = `/planejar/evento/${encodeURIComponent(created.id)}?${new URLSearchParams({ titulo: created.title }).toString()}`;
    const finish = () => navigate(created.private ? eventPath : '/perfil?aba=eventos');
    // Quem foi marcado já conta como convidado: o botão já é "Convidar mais pessoas" e a votação já pode abrir.
    const hasInvites = sharedOnce || created.taggedCount > 0;
    // Marcou gente na criação: o convite já saiu, então não pede de novo aqui (dá para convidar mais pela página do evento).
    const tagged = created.taggedCount > 0;
    const inviteLabel = hasInvites ? t('Convidar mais pessoas') : t('Convidar pessoas');
    return (
      <div className="compose compose--created">
        <header className="compose__bar">
          <span aria-hidden="true" />
          <h1 className="compose__title">{t('Evento criado')}</h1>
          <button type="button" className="compose__next" onClick={finish}>
            {t('Concluir')}
          </button>
        </header>
        <div className="created">
          <span className="created__cover">
            {created.cover ? <img src={created.cover} alt="" referrerPolicy="no-referrer" /> : null}
            <span className="created__check" aria-hidden="true">
              <CheckIcon />
            </span>
          </span>
          <strong className="created__title">{created.title}</strong>
          <p className="muted">
            {created.private
              ? t('Seu evento privado está pronto. Ele só chega a quem receber nas conversas.')
              : t('Seu evento está pronto e já aparece no seu perfil.')}
          </p>
          {created.taggedCount > 0 ? (
            <p className="muted">{created.taggedCount === 1 ? t('Quem você marcou já está convidado.') : t('As {n} pessoas que você marcou já estão convidadas.', { n: created.taggedCount })}</p>
          ) : null}
          {created.dateByPoll ? (
            <>
              <p className="muted">{t('A data vai ser decidida numa votação com todos os convidados. Quem você convidar depois entra na votação também.')}</p>
              {tagged ? null : (
                <Button full onClick={() => setSharing(true)}>
                  <UsersIcon /> {inviteLabel}
                </Button>
              )}
              {hasInvites ? (
                <Button full variant={tagged ? 'primary' : 'secondary'} onClick={() => navigate(pollPath)}>
                  <CalendarIcon /> {t('Abrir a votação da data')}
                </Button>
              ) : null}
            </>
          ) : tagged ? null : (
            <Button full onClick={() => setSharing(true)}>
              <UsersIcon /> {inviteLabel}
            </Button>
          )}
          {created.private ? null : (
            // Fora do app (WhatsApp, Telegram, link...) tem botão próprio: some da folha quando se escolhe um amigo e ela fecha ao enviar.
            <Button full variant="secondary" onClick={() => setSharingOutside(true)}>
              <ShareIcon /> {t('Compartilhar fora do app')}
            </Button>
          )}
          <Button variant="quiet" full onClick={() => navigate(eventPath)}>
            {t('Ver evento')}
          </Button>
        </div>
        {sharing ? (
          <ShareEventSheet
            eventId={created.id}
            source="USER"
            title={created.title}
            sheetTitle={t('Convidar pessoas')}
            invite
            posted={false}
            onPostedChange={() => undefined}
            profile={created.private ? 'private' : 'owner'}
            outside={!created.private}
            {...(pollConversation && !sharedOnce ? { initialConversations: [pollConversation] } : {})}
            // Depois de convidar, continua aqui: dá para convidar mais gente antes de abrir a votação ou concluir.
            onShared={() => setSharedOnce(true)}
            onClose={() => setSharing(false)}
          />
        ) : null}
        {sharingOutside ? (
          <ShareEventSheet
            eventId={created.id}
            source="USER"
            title={created.title}
            sheetTitle={t('Compartilhar fora do app')}
            posted={false}
            onPostedChange={() => undefined}
            profile="owner"
            inApp={false}
            onShared={() => setSharedOnce(true)}
            onClose={() => setSharingOutside(false)}
          />
        ) : null}
      </div>
    );
  }

  if (step === 'details' && kind === 'EVENT') {
    // Tela única do evento: capa no topo, nome grande e as linhas Quando / Onde / Tipo / Quem vê, cada uma com sua folha.
    const missing = [eventTitle.trim() ? null : t('nome'), eventStart || eventDateByPoll ? null : t('data')].filter((m): m is string => m !== null);
    const missingText = missing.length > 0 ? t('Falta: {what}', { what: missing.length > 1 ? `${missing.slice(0, -1).join(', ')} ${t('e')} ${missing[missing.length - 1]}` : missing[0]! }) : null;
    const when = eventDateByPoll ? t('Por votação') : whenLabel(eventStart, eventEnd, new Date());
    const kindLabel = KINDS.find((k) => k.id === eventKind)?.label ?? t('Outros');
    const linkedPhoto = linked?.photo && !(placePhoto && placePhoto.placeName === linked.name) ? linked.photo : null;
    const extrasAnswered = extrasFromDraft(extras, extraOptions.data ?? []).length;
    const moreParts = [tagged.length > 0 ? tagged.map((f) => `@${f.username}`).join(', ') : null, extrasAnswered > 0 ? (extrasAnswered === 1 ? t('1 informação') : t('{count} informações', { count: extrasAnswered })) : null].filter(Boolean);
    const moreHint = (extraOptions.data ?? []).slice(0, 2).map((o) => o.label.toLowerCase());
    const moreSub = moreParts.length > 0 ? moreParts.join(' · ') : [t('Marcar pessoas'), ...moreHint].join(', ') + ((extraOptions.data ?? []).length > 2 ? '…' : '');
    return (
      <div className="compose compose--event">
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={leave} aria-label={t('Cancelar')} disabled={busy}>
            <XIcon />
          </button>
          <h1 className="compose__title">{t('Novo evento')}</h1>
          <button type="button" className="compose__next" disabled={busy || missing.length > 0 || captionLength > POST_CAPTION_MAX} onClick={() => void publish()}>
            {t('Criar')}
          </button>
        </header>
        {fileInput}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {progressBars}

        {cover ? (
          <div className="evcover evcover--compose">
            <img src={cover.preview} alt={t('Capa do evento')} referrerPolicy="no-referrer" />
            <button type="button" className="evcover__change" onClick={() => setStep('photos')} disabled={busy}>
              <PhotoIcon /> {items.length > 1 ? t('Capa e fotos ({count})', { count: items.length }) : t('Trocar capa')}
            </button>
            {cover.kind === 'UPLOAD' && cover.video ? <span className="evcover__video" aria-hidden="true">▶</span> : null}
            <span className="evcover__kind evcover__kind--icon" aria-hidden="true">
              <EventKindIcon kind={eventKind} />
            </span>
            {when ? <span className="evcover__when">{when}</span> : null}
          </div>
        ) : (
          <div className="evcover evcover--compose evcover--empty">
            <p>{reading ? t('Preparando as fotos…') : t('Adicione uma capa (opcional)')}</p>
            <div className="evcover__actions">
              <Button small variant="secondary" loading={reading} onClick={() => fileRef.current?.click()}>
                <PhotoIcon /> {t('Galeria')}
              </Button>
              <Button small variant="secondary" onClick={() => setSheet('placePhoto')}>
                <LocationIcon /> {t('Foto de um local')}
              </Button>
            </div>
          </div>
        )}
        {linkedPhoto && linked ? (
          <div className="evphotohint">
            <img src={api.assetUrl(linkedPhoto.photoPath)} alt="" referrerPolicy="no-referrer" />
            <span>{cover ? t('Trocar a capa pela foto do {place}?', { place: linked.name }) : t('Usar a foto do {place} como capa?', { place: linked.name })}</span>
            <Button
              small
              variant="quiet"
              onClick={() => {
                const image: Extract<DraftImage, { kind: 'PLACE' }> = { key: nextKey(), kind: 'PLACE', preview: api.assetUrl(linkedPhoto.photoPath), photoPath: linkedPhoto.photoPath, author: linkedPhoto.author, placeName: linked.name, placeAddress: linked.address };
                addPlaceImage(image);
              }}
            >
              {t('Usar')}
            </Button>
          </div>
        ) : null}

        <input className="evtitle" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} maxLength={120} placeholder={t('Nome do evento')} aria-label={t('Nome do evento')} disabled={busy} />
        <textarea
          className="evdesc"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={t('Conte mais sobre o evento…')}
          aria-label={t('Descrição do evento')}
          maxLength={POST_CAPTION_MAX + 20}
          rows={2}
          aria-invalid={captionLength > POST_CAPTION_MAX || undefined}
          disabled={busy}
        />
        {captionLength > POST_CAPTION_MAX * 0.8 ? (
          <p className={`compose__count${captionLength > POST_CAPTION_MAX ? ' compose__count--over' : ''}`} aria-live="polite">
            {captionLength}/{POST_CAPTION_MAX}
          </p>
        ) : null}

        <ul className="evrows">
          <EventRow icon={<CalendarIcon />} label={t('Quando')} value={when} placeholder={t('Escolher')} onClick={() => setSheet('when')} disabled={busy} />
          <EventRow
            icon={<LocationIcon />}
            label={t('Onde')}
            value={place?.name}
            placeholder={t('Opcional')}
            onClick={placeFromPhoto && !linked ? undefined : () => setLinking(true)}
            disabled={busy}
            trailing={
              linked ? (
                <button type="button" className="evrow__clear" onClick={() => setLinked(null)} aria-label={t('Remover o local vinculado')}>
                  <XIcon />
                </button>
              ) : null
            }
          />
          <EventRow icon={<EventKindIcon kind={eventKind} />} label={t('Tipo')} value={kindLabel} onClick={() => setSheet('kind')} disabled={busy} />
          <EventRow icon={eventPrivate ? <LockIcon /> : <GlobeIcon />} label={t('Quem vê')} value={eventPrivate ? t('Só convidados') : t('Público')} onClick={() => setSheet('audience')} disabled={busy} />
        </ul>

        <div className={`evmore${moreOpen ? ' evmore--open' : ''}`}>
          <button type="button" className="evmore__head" aria-expanded={moreOpen} aria-controls="evmore-panel" onClick={() => setMoreOpen((o) => !o)}>
            <span className="evrow__icon" aria-hidden="true">
              <PlusIcon />
            </span>
            <span className="evmore__text">
              <span className="evmore__title">{t('Mais detalhes')}</span>
              <span className="evmore__sub">{moreSub}</span>
            </span>
            <span className="evmore__chev" aria-hidden="true">
              <ChevronDownIcon />
            </span>
          </button>
          {moreOpen ? (
            <div className="evmore__panel" id="evmore-panel">
              <button type="button" className="evmore__row" onClick={() => setTagging(true)}>
                <span className="evextras__icon" aria-hidden="true">
                  <UsersIcon />
                </span>
                <span className="evmore__rowtext">
                  <span className="evextras__label">{t('Marcar pessoas')}</span>
                  {tagged.length > 0 ? <span className="evmore__sub">{tagged.map((f) => `@${f.username}`).join(', ')}</span> : null}
                </span>
                {tagged.length > 0 ? (
                  <span className="optrow__avatars" aria-hidden="true">
                    {tagged.slice(0, 3).map((f) => (
                      <Avatar key={f.userId} profile={f} size={24} />
                    ))}
                  </span>
                ) : null}
                <span className="evrow__chev" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              </button>
              <EventExtrasFields embedded options={extraOptions.data ?? []} value={extras} onChange={setExtras} />
            </div>
          ) : null}
        </div>

        <div className="compose__footer">
          <Button full loading={busy} disabled={missing.length > 0 || captionLength > POST_CAPTION_MAX} onClick={() => publish()}>
            {t('Criar evento')}
          </Button>
          {missingText ? <p className="evmissing">{missingText}</p> : null}
        </div>

        {sheet === 'when' ? (
          <EventWhenSheet
            starts={eventStart}
            ends={eventEnd}
            dateByPoll={eventDateByPoll}
            // Vindo de uma votação já fechada, a data já está decidida.
            allowPoll={!fromPoll}
            onDone={(s, e, byPoll) => {
              setEventDateByPoll(byPoll);
              if (!byPoll) {
                setEventStart(s);
                setEventEnd(e);
              }
              setSheet(undefined);
            }}
            onClose={() => setSheet(undefined)}
          />
        ) : null}
        {sheet === 'kind' ? (
          <EventKindSheet
            value={eventKind}
            onPick={(k) => {
              setEventKind(k);
              setSheet(undefined);
            }}
            onClose={() => setSheet(undefined)}
          />
        ) : null}
        {sheet === 'audience' ? (
          <EventAudienceSheet
            isPrivate={eventPrivate}
            onPick={(v) => {
              setEventPrivate(v);
              setSheet(undefined);
            }}
            onClose={() => setSheet(undefined)}
          />
        ) : null}
        {sheet === 'placePhoto' ? (
          <Sheet title={t('Foto de um local')} onClose={() => setSheet(undefined)}>
            <PlacePhotoGrid
              picked={placePhoto?.placeName}
              onPick={(p) => {
                pickPlacePhoto(p);
                setSheet(undefined);
              }}
            />
          </Sheet>
        ) : null}
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
        {discardSheet}
      </div>
    );
  }

  if (step === 'details') {
    return (
      <div className="compose compose--details">
        {fileInput}
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={leave} aria-label={t('Cancelar')} disabled={busy}>
            <XIcon />
          </button>
          <h1 className="compose__title">{kind === 'EVENT' ? t('Novo evento') : t('Nova publicação')}</h1>
          <span aria-hidden="true" />
        </header>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {progressBars}
        {kind === 'EVENT' ? (
          <section className="compose__row" aria-label={t('Dados do evento')}>
            <Field label={t('Nome do evento')} value={eventTitle} onChange={setEventTitle} maxLength={120} />
            <EventKindPicker value={eventKind} onChange={setEventKind} />
            <EventDates starts={eventStart} ends={eventEnd} onStarts={setEventStart} onEnds={setEventEnd} />
            <EventExtrasFields options={extraOptions.data ?? []} value={extras} onChange={setExtras} />
            <p className="muted">{t('O local é opcional: escolha abaixo se quiser.')}</p>
            <label className="check">
              <input type="checkbox" checked={eventPrivate} onChange={(e) => setEventPrivate(e.target.checked)} />
              <span>
                <strong>{t('Evento privado')}</strong>
                <span className="muted">{t('Não aparece no seu perfil nem no feed, e ninguém o posta no próprio perfil. Só chega a quem receber nas conversas.')}</span>
              </span>
            </label>
            <p className="muted">{t('Depois de criar, você escolhe as conversas e grupos que vão receber o evento.')}</p>
          </section>
        ) : null}
        <div className="compose__caption">
          {items.length > 0 ? (
          <button type="button" className="compose__thumb" onClick={() => setStep('photos')} disabled={busy} aria-label={t('Editar fotos ({count})', { count: items.length })}>
            {cover ? <img src={cover.preview} alt="" referrerPolicy="no-referrer" /> : null}
            {items.length > 1 ? (
              <span className="compose__thumbicon" aria-hidden="true">
                <CarouselIcon />
              </span>
            ) : null}
            {cover && cover.kind === 'UPLOAD' && cover.video ? <span className="compose__thumbplay" aria-hidden="true">▶</span> : null}
          </button>
          ) : null}
          <textarea
            className="compose__text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={kind === 'EVENT' ? t('Conte mais sobre o evento…') : items.length === 0 ? t('O que está rolando?') : t('Escreva uma legenda…')}
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
        {kind === 'POST' ? (
          <div className="compose__media">
            <Button small variant="secondary" loading={reading} disabled={busy || room <= 0} onClick={() => fileRef.current?.click()}>
              <PhotoIcon /> {items.length > 0 ? t('Adicionar mais') : t('Fotos ou vídeo')}
            </Button>
            <Button small variant="quiet" disabled={busy} onClick={() => { setSource('place'); setStep('photos'); }}>
              <LocationIcon /> {t('Foto de um local')}
            </Button>
            {items.length > 0 ? (
              <Button small variant="quiet" disabled={busy} onClick={() => { setSource('photos'); setStep('photos'); }}>
                {t('Editar fotos')}
              </Button>
            ) : (
              <span className="muted compose__mediahint">{t('Opcional')}</span>
            )}
          </div>
        ) : null}
        {kind === 'POST' ? <p className="muted compose__linkhint">{place || linkedEvent ? t('Seu post fica vinculado a este evento ou local.') : t('Todo post precisa de um evento ou de um local. Escolha abaixo.')}</p> : null}
        <ul className="optrows">
          {kind === 'POST' ? (
            <li className="optrow">
              <button type="button" className="optrow__main" onClick={() => setPickingEvent(true)}>
                <span className="optrow__icon"><CalendarIcon /></span>
                <span className="optrow__text">
                  <span className="optrow__label">{linkedEvent ? linkedEvent.title : t('Vincular um evento')}</span>
                  {linkedEvent ? <span className="optrow__sub">{t('Evento')}</span> : null}
                </span>
                {linkedEvent ? null : <span className="optrow__chev"><ChevronRightIcon /></span>}
              </button>
              {linkedEvent ? (
                <button type="button" className="optrow__clear" onClick={() => setLinkedEvent(null)} aria-label={t('Remover o evento vinculado')}>
                  <XIcon />
                </button>
              ) : null}
            </li>
          ) : null}
          <li className="optrow">
            {placeFromPhoto ? (
              <div className="optrow__main">
                <span className="optrow__icon"><LocationIcon /></span>
                <span className="optrow__text">
                  <span className="optrow__label">{place?.name}</span>
                  <span className="optrow__sub">{t('O local vem da foto do local que você escolheu.')}</span>
                </span>
              </div>
            ) : (
              <button type="button" className="optrow__main" onClick={() => setLinking(true)}>
                <span className="optrow__icon"><LocationIcon /></span>
                <span className="optrow__text">
                  <span className="optrow__label">{place ? place.name : t('Vincular um local')}</span>
                  {place?.address ? <span className="optrow__sub">{place.address}</span> : null}
                </span>
                {linked ? null : <span className="optrow__chev"><ChevronRightIcon /></span>}
              </button>
            )}
            {linked && !placeFromPhoto ? (
              <button type="button" className="optrow__clear" onClick={() => setLinked(null)} aria-label={t('Remover o local vinculado')}>
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
          <Button full loading={busy} disabled={captionLength > POST_CAPTION_MAX} onClick={() => publish()}>
            {kind === 'EVENT' ? t('Criar evento') : t('Compartilhar')}
          </Button>
        </div>

        {pickingEvent ? (
          <LinkEventSheet
            onPick={(e) => {
              setLinkedEvent(e);
              setPickingEvent(false);
              setMessage(undefined);
            }}
            onClose={() => setPickingEvent(false)}
          />
        ) : null}
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
      {kind === 'EVENT' ? (
        // Evento: esta é só a tela de editar a capa (várias fotos, recorte, foto de um rolê); volta para a tela do evento.
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={() => setStep('details')} aria-label={t('Voltar para o evento')} disabled={reading || cropKey !== undefined}>
            <ChevronLeftIcon />
          </button>
          <h1 className="compose__title">{t('Capa do evento')}</h1>
          <button type="button" className="compose__next" disabled={reading || cropKey !== undefined} onClick={() => setStep('details')}>
            {t('Concluir')}
          </button>
        </header>
      ) : (
        <header className="compose__bar">
          <button type="button" className="iconbtn" onClick={() => setStep('details')} aria-label={t('Voltar para a publicação')} disabled={reading || cropKey !== undefined}>
            <ChevronLeftIcon />
          </button>
          <h1 className="compose__title">{t('Fotos da publicação')}</h1>
          <button type="button" className="compose__next" disabled={reading || cropKey !== undefined} onClick={() => setStep('details')}>
            {t('Concluir')}
          </button>
        </header>
      )}
      {fileInput}


      <div className="segmented" role="tablist" aria-label={t('De onde vem a foto')}>
        <button type="button" role="tab" aria-selected={source === 'photos'} className={`segmented__tab${source === 'photos' ? ' segmented__tab--on' : ''}`} onClick={() => setSource('photos')}>
          {t('Escolher fotos')}
        </button>
        <button type="button" role="tab" aria-selected={source === 'place'} className={`segmented__tab${source === 'place' ? ' segmented__tab--on' : ''}`} onClick={() => setSource('place')}>
          {t('Foto de um local')}
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
            <p className="compose__emptyhint">{kind === 'EVENT' ? t('A primeira foto é a capa. Até {max} itens, com no máximo 1 vídeo.', { max: POST_IMAGES_MAX }) : t('Até {max} itens, com no máximo 1 vídeo.', { max: POST_IMAGES_MAX })}</p>
            <Button small loading={reading} onClick={() => fileRef.current?.click()}>
              {t('Escolher da galeria')}
            </Button>
          </div>
        ) : (
          <div className="compose__empty">
            <span className="compose__emptyicon" aria-hidden="true">
              <LocationIcon />
            </span>
            <p className="compose__emptyhint">{t('Busque um local abaixo para usar a foto dele.')}</p>
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
  const search = useSearch();
  const post = useAsync(() => api.post(postId), [postId]);
  // Post de evento: o nome do evento é o título da página (no lugar de "Post").
  const heading = post.data?.event?.title ?? t('Post');
  useTitle(heading);
  if (post.loading && !post.data) return <PostPageSkeleton />;
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
      <PageHead title={heading} back={`/u/${encodeURIComponent(post.data.author.username)}`} />
      <PostCard poster eventInTitle post={post.data} openComments={search.get('comentarios') === '1'} onGone={(_id, why) => navigate(why === 'hidden' ? '/' : '/perfil')} />
    </>
  );
}
