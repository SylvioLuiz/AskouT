import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from './agenda.tsx';
import { SoundToggle } from './sound-toggle.tsx';
import { ChevronRightIcon, EventKindIcon, TrashIcon, XIcon, MoreIcon } from './icons.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Button, ErrorState, Loading, Notice } from './ui.tsx';
import { VenueLogo } from './venue-logo.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import { mediaKind, prepareImage } from '../lib/chat-media.ts';
import { isVideoFile, videoPoster, videoProblem } from '../lib/post-video.ts';
import { STORY_PHOTO_MS, nextStory, prevStory } from '../lib/stories.ts';
import type { StoryPos } from '../lib/stories.ts';
import { friendsLine, rollingMeta } from '../lib/venue-story.ts';
import { kindLabel } from '../lib/explore.ts';
import type { RollingNowItem, VenueStoryGroup, VenueStoryItem } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Um local com seus stories; `event` leva ao "Eu vou" quando o story vem da faixa "Rolando agora". */
export interface VenueViewerGroup extends VenueStoryGroup {
  event?: RollingNowItem['event'];
}

// ---------- Assistir ----------

/** Visualizador de stories de locais: denunciar e "não tenho interesse" ficam no menu; o rodapé leva ao evento ou ao local. */
export function VenueStoryViewer({ groups, start, onClose, onChanged }: { groups: VenueViewerGroup[]; start: StoryPos; onClose: () => void; onChanged: () => void }) {
  const [pos, setPos] = useState<StoryPos>(start);
  const [muted, setMuted] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const spentRef = useRef(0);
  const group = groups[pos.group];
  const item = group?.items[pos.item];
  const paused = menu || reporting;

  function advance() {
    const next = nextStory(groups, pos);
    if (next) setPos(next);
    else onClose();
  }
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    spentRef.current = 0;
    setError(undefined);
  }, [item?.id]);

  useEffect(() => {
    if (!item || paused) return;
    let frame = 0;
    let last = performance.now();
    const paint = (ratio: number) => {
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`;
    };
    const tick = (now: number) => {
      if (item.kind === 'IMAGE') {
        spentRef.current += Math.min(now - last, 100);
        last = now;
        const ratio = Math.min(1, spentRef.current / STORY_PHOTO_MS);
        paint(ratio);
        if (ratio >= 1) {
          advanceRef.current();
          return;
        }
      } else {
        const video = videoRef.current;
        paint(video && video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [item?.id, paused]);

  useEffect(() => {
    if (paused) videoRef.current?.pause();
    else void videoRef.current?.play().catch(() => undefined);
  }, [paused]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') advanceRef.current();
      if (event.key === 'ArrowLeft') setPos((p) => prevStory(groups, p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [groups, onClose]);

  if (!group || !item) return null;

  async function mute() {
    if (!group) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.muteVenueStories(group.venue.id, true);
      onChanged();
    } catch (failure) {
      setError(toApiError(failure).message);
      setBusy(false);
      setMenu(false);
    }
  }

  const src = api.venueStoryMediaUrl(item.id);
  const target = group.event ? `/eventos/${encodeURIComponent(group.event.id)}` : `/bares/${encodeURIComponent(group.venue.id)}`;
  return (
    <div className="storyview storyview--placed" role="dialog" aria-modal="true" aria-label={t('Story de {name}', { name: group.venue.name })}>
      <div className="storyview__bars" aria-hidden="true">
        {group.items.map((it, index) => (
          <span key={it.id} className="storyview__bar">
            <span ref={index === pos.item ? fillRef : undefined} className="storyview__fill" style={{ transform: index < pos.item ? 'scaleX(1)' : 'scaleX(0)' }} />
          </span>
        ))}
      </div>
      <header className="storyview__head">
        <Link to={`/bares/${encodeURIComponent(group.venue.id)}`} className="storyview__who">
          <VenueLogo name={group.venue.name} logoUrl={group.venue.logoUrl} size={36} />
          <span className="storyview__whotext">
            <span className="storyview__whoname">
              <strong>{group.venue.name}</strong>
              <span>{timeAgo(item.createdAt, new Date())}</span>
            </span>
          </span>
        </Link>
        <button type="button" className="storyview__btn storyview__btn--quiet" onClick={() => setMenu(true)} aria-label={t('Mais opções do story')} aria-haspopup="dialog">
          <MoreIcon />
        </button>
        <button type="button" className="storyview__btn" onClick={onClose} aria-label={t('Fechar')}>
          <XIcon />
        </button>
      </header>
      <div className="storyview__stage">
        {item.kind === 'VIDEO' ? (
          <video key={item.id} ref={videoRef} className="storyview__media" src={src} autoPlay playsInline muted={muted} onEnded={advance} onError={() => setError(t('Não foi possível abrir este vídeo.'))} />
        ) : (
          <img key={item.id} className="storyview__media" src={src} alt="" onError={() => setError(t('Não foi possível abrir esta foto.'))} />
        )}
        <button type="button" className="storyview__tap storyview__tap--prev" onClick={() => setPos(prevStory(groups, pos))} aria-label={t('Story anterior')} />
        <button type="button" className="storyview__tap storyview__tap--next" onClick={advance} aria-label={t('Próximo story')} />
        {item.kind === 'VIDEO' ? <SoundToggle muted={muted} onToggle={() => setMuted((m) => !m)} /> : null}
      </div>
      <Link to={target} className="storyplace" aria-label={group.event ? t('Abrir o evento {title}', { title: group.event.title }) : t('Abrir a página de {name}', { name: group.venue.name })}>
        <span className={`storyplace__thumb${group.event ? ` evcover--${group.event.kind.toLowerCase()}` : ''}`} aria-hidden="true">
          {group.event ? <EventKindIcon kind={group.event.kind} /> : <VenueLogo name={group.venue.name} logoUrl={group.venue.logoUrl} size={44} />}
        </span>
        <span className="storyplace__body">
          <strong className="storyplace__title">{group.event ? group.event.title : group.venue.name}</strong>
          <span className="storyplace__where">{group.event ? t('{name} · Eu vou', { name: group.venue.name }) : t('Ver o local e seguir')}</span>
        </span>
        <span className="storyplace__go" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      </Link>
      {error ? <p className="storyview__error">{error}</p> : null}
      {menu ? (
        <Sheet title={t('Story de {name}', { name: group.venue.name })} onClose={() => setMenu(false)}>
          <div className="storysheet__actions">
            <Button
              variant="secondary"
              onClick={() => {
                setMenu(false);
                setReporting(true);
              }}
            >
              {t('Denunciar story')}
            </Button>
            <Button variant="secondary" loading={busy} onClick={() => void mute()}>
              {t('Não tenho interesse neste local')}
            </Button>
          </div>
          <p className="muted">{t('Sem interesse: o local some da sua página inicial e do Rolando agora. Você desfaz em Configuração.')}</p>
        </Sheet>
      ) : null}
      {reporting ? (
        <ReasonSheet
          title={t('Denunciar story')}
          doneText={t('Denúncia enviada. Você não verá mais este story.')}
          submit={(reason, details) => api.reportVenueStory(item.id, reason, details)}
          onClose={() => setReporting(false)}
          onDone={() => {
            setReporting(false);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------- Home ----------

/** Faixa da Home com os stories dos locais que você segue (ao lado da dos amigos). */
export function VenueStoriesStrip({ groups, onChanged }: { groups: VenueStoryGroup[]; onChanged: () => void }) {
  const [viewing, setViewing] = useState<StoryPos | undefined>();
  if (groups.length === 0) return null;
  return (
    <section className="homestories" aria-label={t('Stories dos locais que você segue')}>
      <ul className="homestories__list">
        {groups.map((group, index) => (
          <li key={group.venue.id}>
            <button type="button" className="homestories__item" onClick={() => setViewing({ group: index, item: 0 })} aria-label={t('Ver o story de {name}', { name: group.venue.name })}>
              <span className="homestories__ring">
                <VenueLogo name={group.venue.name} logoUrl={group.venue.logoUrl} size={60} />
              </span>
              <span className="homestories__name">{group.venue.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {viewing ? (
        <VenueStoryViewer
          groups={groups}
          start={viewing}
          onClose={() => setViewing(undefined)}
          onChanged={() => {
            setViewing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

// ---------- Explorar ----------

/**
 * "Rolando agora": stories de locais verificados e eventos em andamento, perto de você, com amigos e interesses no topo.
 * Fica escondida quando não há nada (ou quando a pessoa desligou os stories de locais e não há evento).
 */
export function RollingNowStrip({ position, waiting }: { position: { lat: number; lng: number } | undefined; waiting: boolean }) {
  const rolling = useAsync(async () => (waiting ? { items: [] as RollingNowItem[] } : api.rollingNow(position)), [position?.lat, position?.lng, waiting]);
  const [viewing, setViewing] = useState<StoryPos | undefined>();
  const items = rolling.data?.items ?? [];
  if (items.length === 0) return null;
  const withStories = items.filter((i) => i.stories.length > 0);
  const viewerGroups: VenueViewerGroup[] = withStories.map((i) => ({ venue: i.venue, items: i.stories as VenueStoryItem[], event: i.event }));
  return (
    <section className="rolling" aria-labelledby="rolling-title">
      <h2 className="rolling__title" id="rolling-title">
        <span className="rolling__live" aria-hidden="true" />
        {t('Rolando agora')}
      </h2>
      <ul className="homestories__list">
        {items.map((item) => {
          const index = withStories.indexOf(item);
          const meta = rollingMeta(item);
          const body = (
            <>
              <span className={index >= 0 ? 'homestories__ring' : 'rolling__plain'}>
                <VenueLogo name={item.venue.name} logoUrl={item.venue.logoUrl} size={60} />
              </span>
              <span className="homestories__name">{item.venue.name}</span>
              {item.event ? <span className="rolling__event">{item.event.title}</span> : null}
              {meta.length > 0 ? <span className="rolling__meta">{meta[meta.length - 1] ?? ''}</span> : null}
              {item.event ? <span className="rolling__kind">{kindLabel(item.event.kind)}</span> : null}
            </>
          );
          return (
            <li key={item.venue.id}>
              {index >= 0 ? (
                <button type="button" className="homestories__item rolling__item" onClick={() => setViewing({ group: index, item: 0 })} aria-label={t('Ver o story de {name}', { name: item.venue.name }) + (item.event ? `. ${item.event.title}` : '') + (friendsLine(item) ? `. ${friendsLine(item)}` : '')}>
                  {body}
                </button>
              ) : (
                <Link to={item.event ? `/eventos/${encodeURIComponent(item.event.id)}` : `/bares/${encodeURIComponent(item.venue.id)}`} className="homestories__item rolling__item" aria-label={item.event ? t('Abrir o evento {title}', { title: item.event.title }) : t('Abrir a página de {name}', { name: item.venue.name })}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {viewing ? (
        <VenueStoryViewer
          groups={viewerGroups}
          start={viewing}
          onClose={() => setViewing(undefined)}
          onChanged={() => {
            setViewing(undefined);
            rolling.reload();
          }}
        />
      ) : null}
    </section>
  );
}

// ---------- Painel do local ----------

/** O responsável publica e apaga os stories do local (aparece só em local com responsável). */
export function VenueStorySheet({ venueId, onClose }: { venueId: string; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useAsync(() => api.ownerVenueStories(venueId), [venueId]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    setProblem(undefined);
    setBusy(true);
    let blob: Blob;
    try {
      const kind = mediaKind(picked);
      if (kind === 'VIDEO' || isVideoFile(picked)) {
        const bad = videoProblem(picked);
        if (bad) throw new Error(bad);
        await videoPoster(picked);
        blob = picked;
      } else if (kind === 'IMAGE') {
        blob = await prepareImage(picked);
      } else {
        throw new Error(t('Escolha uma foto ou um vídeo.'));
      }
    } catch (failure) {
      setProblem(failure instanceof Error && failure.message !== 'grande' && failure.message !== 'canvas' ? failure.message : t('Não foi possível usar este arquivo. Tente outro.'));
      setBusy(false);
      return;
    }
    try {
      await api.publishVenueStory(venueId, blob);
      list.reload();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(storyId: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      await api.deleteVenueStory(venueId, storyId);
      list.reload();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const data = list.data;
  return (
    <Sheet title={t('Stories do local')} onClose={onClose}>
      <p className="muted">{t('Foto ou vídeo. Quem segue o local vê na página inicial e o Explorar mostra em Rolando agora. Fica no ar por 24 h.')}</p>
      <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="visually-hidden" onChange={(event) => void pick(event)} aria-label={t('Escolher foto ou vídeo')} />
      {list.loading && !data ? <Loading /> : null}
      {list.error && !data ? <ErrorState message={list.error.message} onRetry={list.reload} /> : null}
      {data?.suspended ? <Notice tone="error">{t('A publicação de stories deste local está suspensa até a equipe do AskouT analisar as denúncias.')}</Notice> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {data && data.items.length > 0 ? (
        <ul className="vstories" aria-label={t('Stories no ar')}>
          {data.items.map((s) => (
            <li key={s.id} className="vstories__item">
              {s.kind === 'VIDEO' ? <video src={api.venueStoryMediaUrl(s.id)} muted playsInline preload="metadata" /> : <img src={api.venueStoryMediaUrl(s.id)} alt="" />}
              <button type="button" className="vstories__del" onClick={() => void remove(s.id)} disabled={busy} aria-label={t('Apagar este story')}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : data ? (
        <p className="muted">{t('Nenhum story no ar.')}</p>
      ) : null}
      <div className="storysheet__actions">
        <Button loading={busy} disabled={data?.suspended === true} onClick={() => fileRef.current?.click()}>
          {t('Publicar foto ou vídeo')}
        </Button>
      </div>
    </Sheet>
  );
}
