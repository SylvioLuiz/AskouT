import { useEffect, useState } from 'react';
import { Avatar, Button } from './ui.tsx';
import { PostCard } from './post.tsx';
import { trackClick, useDwell } from './dwell.tsx';
import { EventKindIcon } from './icons.tsx';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { readPersonalize } from '../lib/dwell.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import type { RecommendationItem, RecommendationSource } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Reasons({ item }: { item: RecommendationItem }) {
  return (
    <ul className="foryou__reasons">
      {item.friendsGoing.length > 0 ? (
        <li className="foryou__faces" aria-hidden="true">
          {item.friendsGoing.map((p) => (<Avatar key={p.userId} profile={p} size={22} />))}
        </li>
      ) : null}
      {item.reasons.map((r) => (<li key={r}>{r}</li>))}
    </ul>
  );
}

/** Botão Seguir de quem fez o post ou o evento (pessoa ou estabelecimento). Some quando você já segue. */
function FollowSource({ source }: { source: RecommendationSource | null }) {
  const [state, setState] = useState<RecommendationSource['follow']>(source?.follow ?? 'FOLLOWING');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!source || state === 'FOLLOWING') return null;
  async function follow(): Promise<void> {
    if (!source) return;
    setBusy(true);
    setFailed(false);
    try {
      if (source.kind === 'VENUE') {
        await api.followVenue(source.id);
        setState('FOLLOWING');
      } else {
        const r = await api.follow(source.id);
        setState(r.status === 'ACCEPTED' ? 'FOLLOWING' : 'PENDING');
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const label = source.kind === 'VENUE' ? source.name : `@${source.name}`;
  return (
    <div className="foryou__follow">
      {state === 'PENDING' ? (
        <span className="foryou__followed">Pedido enviado para {label}</span>
      ) : (
        <Button small variant="secondary" loading={busy} onClick={() => void follow()} aria-label={t('Seguir {label}', { label })}>
          Seguir {label}
        </Button>
      )}
      {failed ? <span className="foryou__followerr" role="alert">{t('Não deu para seguir agora.')}</span> : null}
    </div>
  );
}

function EventReco({ item }: { item: RecommendationItem }) {
  const e = item.event!;
  const ref = useDwell<HTMLLIElement>('EVENT', e.id, 'RECO');
  const image = safeImage(e.imageUrl);
  return (
    <li ref={ref} className="foryou__card">
      <Link to={`/eventos/${encodeURIComponent(e.id)}`} className="foryou__link" onClick={() => trackClick('EVENT', e.id, 'RECO')}>
        <span className={`foryou__cover evcover--${e.kind.toLowerCase()}`}>
          {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <EventKindIcon kind={e.kind} />}
        </span>
        <strong className="foryou__title">{e.title}</strong>
        <span className="foryou__meta">{e.venueName} · {kindLabel(e.kind)}</span>
        <span className="foryou__meta">{when(e.startsAt)}</span>
      </Link>
      {item.sponsored ? <span className="tag-sponsored foryou__ad">{t('Patrocinado')}</span> : null}
      <Reasons item={item} />
      <FollowSource source={item.source} />
    </li>
  );
}

function PostReco({ item }: { item: RecommendationItem }) {
  const ref = useDwell<HTMLLIElement>('POST', item.post!.id, 'RECO');
  return (
    <li ref={ref} className="foryou__post" onClickCapture={(ev) => { if ((ev.target as Element).closest('a')) trackClick('POST', item.post!.id, 'RECO'); }}>
      <PostCard post={item.post!} asEvent poster />
      <Reasons item={item} />
      <FollowSource source={item.source} />
    </li>
  );
}

/** Bloco no meio da Home: o que seus amigos mais próximos foram ou curtiram e o que combina com o que te prende. */
export function ForYou({ reloadKey }: { reloadKey?: string }) {
  const me = useUser().profile.userId;
  const [items, setItems] = useState<RecommendationItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.recommendations(readPersonalize(me)).then(
      (r) => { if (!cancelled) setItems(r.items); },
      () => { if (!cancelled) setItems([]); },
    );
    return () => { cancelled = true; };
  }, [me, reloadKey]);
  if (items.length === 0) return null;
  return (
    <section className="foryou" aria-labelledby="foryou-titulo">
      <h2 id="foryou-titulo" className="section__title">{t('Para você')}</h2>
      <ul className="foryou__list">
        {items.map((item) => (item.type === 'EVENT' && item.event ? <EventReco key={`e${item.event.id}`} item={item} /> : item.post ? <PostReco key={`p${item.post.id}`} item={item} /> : null))}
      </ul>
    </section>
  );
}
