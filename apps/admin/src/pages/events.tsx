import { useState } from 'react';
import { api, appUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { EVENT_KIND_LABEL, eventStatus, formatDateTime, formatDuration, formatEventWhen } from '../labels.ts';
import type { PlaceEventRow } from '../types.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';

const STATUS_LABEL = { UPCOMING: 'Por vir', LIVE: 'Acontecendo agora', PAST: 'Já passou' } as const;
const STATUS_TONE = { UPCOMING: 'info', LIVE: 'ok', PAST: undefined } as const;

/**
 * Detalhe do evento: quando, onde, quem responde, quem confirmou e as outras datas com o mesmo nome
 * (locais repetem o nome toda semana; dá para pular de uma data para outra sem fechar).
 */
export function EventDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [currentId, setCurrentId] = useState(id);
  const detail = useAsync(() => api.placeEvent(currentId), [currentId]);
  return (
    <Modal title={detail.data?.title ?? 'Evento'} onClose={onClose} wide>
      <Loadable state={detail} empty="Evento não encontrado." isEmpty={() => false}>
        {(e) => (
          <div className="venuedetail">
            <div className="venuedetail__badges">
              <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
              <Badge>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</Badge>
              {e.isFree ? <Badge tone="ok">Grátis</Badge> : null}
              {e.isSample ? <Badge>Teste</Badge> : null}
              {e.sameTitleTotal > 1 ? <Badge tone="warn">{e.sameTitleTotal} datas com este nome</Badge> : null}
            </div>
            <p className="eventdetail__when">{formatEventWhen(e.startsAt, e.endsAt)}</p>
            <p className="muted small">
              <strong>{e.venue.name}</strong>
              {e.venue.address ? ` · ${e.venue.address}` : ''}
            </p>
            <p className="venuedetail__links small">
              <a href={appUrl(`/eventos/${encodeURIComponent(e.id)}`)} target="_blank" rel="noopener noreferrer">
                Abrir no app
              </a>
              <a href={appUrl(`/bares/${encodeURIComponent(e.venue.id)}`)} target="_blank" rel="noopener noreferrer">
                Página do local
              </a>
              {e.ticketUrl ? (
                <a href={e.ticketUrl} target="_blank" rel="noopener noreferrer">
                  Link do ingresso
                </a>
              ) : null}
            </p>
            {e.imageUrl ? <img className="eventdetail__cover" src={e.imageUrl} alt="" referrerPolicy="no-referrer" /> : null}
            <dl className="venuedetail__facts">
              <div>
                <dt>Início</dt>
                <dd>{formatDateTime(e.startsAt)}</dd>
              </div>
              <div>
                <dt>Fim</dt>
                <dd>{formatDateTime(e.endsAt)}</dd>
              </div>
              <div>
                <dt>Duração</dt>
                <dd>{formatDuration(e.startsAt, e.endsAt)}</dd>
              </div>
              <div>
                <dt>Entrada</dt>
                <dd>{e.isFree ? 'Grátis' : e.ticketUrl ? 'Paga (com link)' : 'Paga ou não informada'}</dd>
              </div>
              <div>
                <dt>Responsável pelo local</dt>
                <dd>{e.venue.owner ? <span className="handle">@{e.venue.owner.username}</span> : <span className="muted">Sem responsável</span>}</dd>
              </div>
              <div>
                <dt>Confirmados</dt>
                <dd>{e.goingCount}</dd>
              </div>
            </dl>
            <h3 className="venuedetail__h">Descrição</h3>
            {e.description ? <p className="small eventdetail__desc">{e.description}</p> : <p className="muted small">Sem descrição.</p>}
            {e.tags.length > 0 ? (
              <div className="venuedetail__badges">
                {e.tags.map((tag) => (
                  <Badge key={tag}>#{tag}</Badge>
                ))}
              </div>
            ) : null}
            {e.sameTitle.length > 0 ? (
              <>
                <h3 className="venuedetail__h">Outras datas com este nome ({e.sameTitleTotal - 1})</h3>
                <ul className="venuedetail__events">
                  {e.sameTitle.map((o) => (
                    <li key={o.id} className={o.upcoming ? undefined : 'is-past'}>
                      <button type="button" className="linkbtn" onClick={() => setCurrentId(o.id)}>
                        {formatEventWhen(o.startsAt, o.endsAt)}
                      </button>
                      <span className="muted small">{o.upcoming ? 'Por vir' : 'Já passou'}</span>
                    </li>
                  ))}
                </ul>
                {e.sameTitleTotal - 1 > e.sameTitle.length ? <p className="muted small">Mostrando as {e.sameTitle.length} datas mais próximas desta.</p> : null}
              </>
            ) : null}
            <h3 className="venuedetail__h">Quem confirmou ({e.goingCount})</h3>
            {e.going.length === 0 ? (
              <p className="muted">Ninguém confirmou ainda.</p>
            ) : (
              <ul className="venuedetail__events">
                {e.going.map((g) => (
                  <li key={g.id}>
                    <span>
                      <span className="handle">@{g.username}</span> {g.displayName ? <span className="muted small">{g.displayName}</span> : null}
                    </span>
                    <span className="small muted">{formatDateTime(g.at)}</span>
                  </li>
                ))}
                {e.goingCount > e.going.length ? <li className="muted small">e mais {e.goingCount - e.going.length}</li> : null}
              </ul>
            )}
            <p className="muted eventdetail__id">ID {e.id}</p>
            <div className="modal__actions">
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </Loadable>
    </Modal>
  );
}

/** Mesmo local + mesmo nome (sem diferenciar maiúsculas): o mesmo evento em outra data. */
const titleKey = (e: PlaceEventRow) => `${e.venue.id}|${e.title.trim().toLocaleLowerCase('pt-BR')}`;

type EventSort = 'title' | 'venue' | 'startsAt' | 'kind';

export function EventsPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const [openId, setOpenId] = useState<string>();
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<EventSort>();
  const onSort = (column: EventSort, first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.placeEvents({ q, offset, sort }), [q, offset, sort]);
  return (
    <>
      <PageHead title="Eventos" hint="Eventos de locais. Os eventos criados por pessoas aparecem em Posts (filtro “só eventos”).">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar por evento ou local…" label="Buscar evento" />
      </PageHead>
      <Loadable state={list} empty="Nenhum evento encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => {
          // Eventos semanais repetem o nome: conta quantas vezes cada um aparece nesta página para avisar.
          const titleCount = new Map<string, number>();
          for (const e of page.items) titleCount.set(titleKey(e), (titleCount.get(titleKey(e)) ?? 0) + 1);
          return (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <SortTh label="Evento" column="title" sort={sort} onSort={onSort} />
                    <SortTh label="Local" column="venue" sort={sort} onSort={onSort} />
                    <SortTh label="Quando" column="startsAt" sort={sort} onSort={onSort} first="desc" />
                    <SortTh label="Tipo" column="kind" sort={sort} onSort={onSort} />
                    <th className="num">Confirmados</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((e) => {
                    const status = eventStatus(e.startsAt, e.endsAt);
                    const when = formatEventWhen(e.startsAt, e.endsAt);
                    const repeats = (titleCount.get(titleKey(e)) ?? 0) > 1;
                    return (
                      <tr key={e.id} className={status === 'PAST' ? 'is-past' : undefined}>
                        <td>
                          <button type="button" className="linkbtn" onClick={() => setOpenId(e.id)} aria-label={`Abrir o detalhe de ${e.title}, ${when}`}>
                            <strong>{e.title}</strong>
                          </button>{' '}
                          {status === 'LIVE' ? <Badge tone="ok">Agora</Badge> : null} {e.isFree ? <Badge tone="ok">Grátis</Badge> : null} {e.isSample ? <Badge>Teste</Badge> : null}
                          {repeats ? <div className="muted small">Mesmo nome mais de uma vez nesta página: veja a data</div> : null}
                        </td>
                        <td>
                          {e.venue.name}
                          {e.venue.address ? <div className="muted small">{e.venue.address}</div> : null}
                        </td>
                        <td>
                          <span className="nowrap">{when}</span>
                          <div className="muted small">
                            {STATUS_LABEL[status]} · {formatDuration(e.startsAt, e.endsAt)}
                          </div>
                        </td>
                        <td>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</td>
                        <td className="num">{e.goingCount}</td>
                        <td className="right">
                          <button
                            type="button"
                            className="btn btn--small btn--danger-quiet"
                            onClick={() =>
                              setAction({
                                title: `Apagar “${e.title}” de ${when}`,
                                description: <p>O evento some do Explorar e das páginas de quem já o viu. As outras datas com o mesmo nome continuam. Isso não pode ser desfeito.</p>,
                                confirmLabel: 'Apagar evento',
                                danger: true,
                                noteLabel: 'Motivo',
                                noteRequired: true,
                                run: (note) => api.deletePlaceEvent(e.id, note),
                              })
                            }
                          >
                            Apagar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
            </>
          );
        }}
      </Loadable>
      {openId ? <EventDetailModal id={openId} onClose={() => setOpenId(undefined)} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
