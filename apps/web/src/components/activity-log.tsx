import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { activityDetail, activityPath, activitySentence, appendPage, groupByDay, type ActivityFilter, type ActivityItem } from '../lib/activity-log.ts';
import { toApiError } from '../lib/errors.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';
import { Link } from '../router.tsx';
import { CalendarIcon, CommentIcon, HeartIcon, PhotoIcon, UserPlusIcon } from './icons.tsx';
import { Avatar, Button, EmptyState, ErrorState, Loading } from './ui.tsx';

const CATEGORY: Record<ActivityItem['kind'], string> = { LIKE: 'like', COMMENT: 'comment', POST: 'social', FOLLOW: 'social', EVENT: 'event' };

function KindIcon({ kind }: { kind: ActivityItem['kind'] }) {
  switch (kind) {
    case 'LIKE':
      return <HeartIcon filled />;
    case 'COMMENT':
      return <CommentIcon />;
    case 'POST':
      return <PhotoIcon />;
    case 'FOLLOW':
      return <UserPlusIcon />;
    case 'EVENT':
      return <CalendarIcon />;
  }
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const path = activityPath(item);
  const detail = activityDetail(item);
  const time = new Date(item.at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const body = (
    <>
      {item.person ? (
        <span className="newsmedia">
          <Avatar profile={item.person} size={44} />
          <span className={`newsmedia__badge newscat--${CATEGORY[item.kind]}`} aria-hidden="true">
            <KindIcon kind={item.kind} />
          </span>
        </span>
      ) : (
        <span className={`newsmedia newsmedia__icon newscat--${CATEGORY[item.kind]}`} aria-hidden="true">
          <KindIcon kind={item.kind} />
        </span>
      )}
      <span className="actlog__text">
        <span className="actlog__sentence">{activitySentence(item)}</span>
        {detail ? <span className="actlog__detail">{detail}</span> : null}
        <span className="actlog__time">{time}</span>
      </span>
    </>
  );
  return <li>{path ? <Link to={path} className="actlog__row">{body}</Link> : <div className="actlog__row actlog__row--off">{body}</div>}</li>;
}

/** Ícone de cada aba de "Suas interações". */
export function ActivityKindIcon({ kind }: { kind: ActivityItem['kind'] }) {
  return <KindIcon kind={kind} />;
}

/** Registro de atividades de um tipo (ou todos): o que você fez, por dia. A aba fica na tela, que passa o filtro. */
export function ActivityLog({ filter }: { filter: ActivityFilter }) {
  const first = useAsync(async () => ({ filter, page: await api.myActivity(filter) }), [filter]);
  // Páginas extras de "Carregar mais", sempre do filtro atual.
  const [more, setMore] = useState<{ filter: ActivityFilter; items: ActivityItem[]; cursor: string | null } | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | undefined>();

  const firstPage = first.data?.filter === filter ? first.data.page : undefined;
  const extra = more?.filter === filter ? more : undefined;
  const items = firstPage ? appendPage(firstPage.items, extra?.items ?? []) : [];
  const cursor = extra ? extra.cursor : (firstPage?.nextCursor ?? null);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await api.myActivity(filter, cursor);
      setMore({ filter, items: appendPage(extra?.items ?? [], page.items), cursor: page.nextCursor });
    } catch (failure) {
      setMoreError(toApiError(failure).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const groups = groupByDay(items, new Date());
  return (
    <section className="actlog" aria-label={t('Registro de atividades')}>
      {!firstPage && !first.error ? <Loading /> : null}
      {first.error ? <ErrorState message={first.error.message} onRetry={first.reload} /> : null}
      {firstPage && items.length === 0 ? (
        <EmptyState title={t('Nada por aqui ainda')}>{filter === 'ALL' ? t('Quando você curtir, comentar, postar, seguir alguém ou confirmar presença num evento, aparece aqui.') : t('Nenhuma atividade desse tipo ainda.')}</EmptyState>
      ) : null}
      {groups.map((g) => (
        <div key={g.key} className="actlog__day">
          <h3 className="actlog__dayhead">{g.label}</h3>
          <ul className="actlog__list">
            {g.items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ))}
      {moreError ? <p className="muted" role="alert">{moreError}</p> : null}
      {firstPage && cursor ? (
        <Button full variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
          {t('Carregar mais')}
        </Button>
      ) : null}
    </section>
  );
}
