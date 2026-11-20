import { useEffect, useState } from 'react';
import { Avatar, Button } from './ui.tsx';
import { PostCard } from './post.tsx';
import { trackClick, useDwell } from './dwell.tsx';
import { trackSponsoredOpen, useSponsoredView } from './sponsored-view.tsx';
import { CheckIcon, EventKindIcon, PlusIcon } from './icons.tsx';
import { DateBadge } from './poster.tsx';
import { SampleBadge } from './suggestions.tsx';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { readPersonalize } from '../lib/dwell.ts';
import { positionWithin } from '../lib/position.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import type { RecommendationItem, RecommendationSource } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

const hour = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });

/** Um motivo só, para não empilhar etiquetas: o principal (o servidor põe primeiro "Fulana e mais 2 amigos vão"), com os rostos de quem vai. */
function Reason({ item }: { item: RecommendationItem }) {
  const first = item.reasons[0];
  if (!first && item.friendsGoing.length === 0) return null;
  return (
    <p className="foryou__why">
      {item.friendsGoing.length > 0 ? (
        <span className="foryou__faces" aria-hidden="true">
          {item.friendsGoing.slice(0, 3).map((p) => (
            <Avatar key={p.userId} profile={p} size={22} />
          ))}
        </span>
      ) : null}
      {first ? <span>{first}</span> : null}
    </p>
  );
}

/**
 * Seguir quem fez o post ou o evento (pessoa ou estabelecimento). Some quando você já segue.
 * `overlay`: o "+" redondo no canto do cartaz; sem ele, o botão com o nome (embaixo dos posts).
 */
function FollowSource({ source, overlay = false }: { source: RecommendationSource | null; overlay?: boolean }) {
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
  if (overlay) {
    const pending = state === 'PENDING';
    const text = pending ? t('Pedido enviado para {label}', { label }) : failed ? t('Não deu para seguir agora.') : t('Seguir {label}', { label });
    return (
      <button
        type="button"
        className={`foryou__plus${pending ? ' foryou__plus--done' : ''}`}
        onClick={() => {
          if (!pending) void follow();
        }}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={text}
        title={text}
      >
        {pending ? <CheckIcon /> : <PlusIcon />}
      </button>
    );
  }
  return (
    <div className="foryou__follow">
      {state === 'PENDING' ? (
        <span className="foryou__followed">{t('Pedido enviado para {label}', { label })}</span>
      ) : (
        <Button small variant="secondary" loading={busy} onClick={() => follow()} aria-label={t('Seguir {label}', { label })}>
          {t('Seguir {label}', { label })}
        </Button>
      )}
      {failed ? (
        <span className="foryou__followerr" role="alert">
          {t('Não deu para seguir agora.')}
        </span>
      ) : null}
    </div>
  );
}

/** Evento recomendado em formato de cartaz: foto inteira, data no canto, título e lugar numa faixa embaixo. */
function EventReco({ item }: { item: RecommendationItem }) {
  const e = item.event!;
  const ref = useDwell<HTMLLIElement>('EVENT', e.id, 'RECO');
  // No "Para você", o patrocinado é sempre o Match.
  useSponsoredView<HTMLLIElement>(item.sponsored, 'MATCH', { eventId: e.id }, ref);
  const image = safeImage(e.imageUrl);
  return (
    <li ref={ref} className="foryou__card">
      <div className="foryou__poster">
        <Link
          to={`/eventos/${encodeURIComponent(e.id)}`}
          className="foryou__link"
          onClick={() => {
            trackClick('EVENT', e.id, 'RECO');
            if (item.sponsored) trackSponsoredOpen('MATCH', { eventId: e.id });
          }}
        >
          <span className={`foryou__cover evcover--${e.kind.toLowerCase()}`}>
            {image ? (
              <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
            ) : (
              <span className="foryou__icon" aria-hidden="true">
                <EventKindIcon kind={e.kind} />
              </span>
            )}
          </span>
          <DateBadge startsAt={e.startsAt} mini />
          <span className="foryou__caption">
            <span className="foryou__tags">
              {item.sponsored ? <span className="tag-sponsored">{t('Patrocinado')}</span> : null}
              {e.isFree ? <span className="tag tag--free">{t('Grátis')}</span> : null}
              {e.sample ? <SampleBadge /> : null}
            </span>
            <strong className="foryou__title">{e.title}</strong>
            <span className="foryou__meta">
              {e.venueName} · {kindLabel(e.kind)} · {hour(e.startsAt)}
            </span>
          </span>
        </Link>
        <FollowSource source={item.source} overlay />
      </div>
      <Reason item={item} />
    </li>
  );
}

function PostReco({ item }: { item: RecommendationItem }) {
  const ref = useDwell<HTMLLIElement>('POST', item.post!.id, 'RECO');
  return (
    <li
      ref={ref}
      className="foryou__post"
      onClickCapture={(ev) => {
        if ((ev.target as Element).closest('a')) trackClick('POST', item.post!.id, 'RECO');
      }}
    >
      <PostCard post={item.post!} asEvent poster />
      <Reason item={item} />
      <FollowSource source={item.source} />
    </li>
  );
}

/** Bloco no meio da Home: o que seus amigos mais próximos foram ou curtiram e o que combina com o que te prende. */
export function ForYou({ reloadKey }: { reloadKey?: string }) {
  const me = useUser().profile.userId;
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [control, setControl] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Espera a posição um instante (ela é pedida ao entrar na Home); sem permissão ou sinal, segue sem ela.
    positionWithin(3000).then((position) => api.recommendations(readPersonalize(me), position)).then(
      (r) => {
        if (!cancelled) {
          setItems(r.items);
          setControl(r.group === 'control');
        }
      },
      () => {
        if (!cancelled) setItems([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [me, reloadKey]);
  if (items.length === 0) return null;
  return (
    <section className="foryou enter" {...(control ? {} : { 'aria-labelledby': 'foryou-titulo' })}>
      {/* Grupo de controle do teste A/B: sem o bloco, só o anúncio pago, sem o título "Para você". */}
      {control ? null : (
        <div className="foryou__head">
          <h2 id="foryou-titulo" className="section__title">
            {t('Para você')}
          </h2>
          <p className="foryou__sub">{t('Pelo que você curte e pelos seus amigos')}</p>
        </div>
      )}
      <ul className="foryou__list">
        {items.map((item) => (item.type === 'EVENT' && item.event ? <EventReco key={`e${item.event.id}`} item={item} /> : item.post ? <PostReco key={`p${item.post.id}`} item={item} /> : null))}
      </ul>
    </section>
  );
}
