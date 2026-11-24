import { useState } from 'react';
import { api, appUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { EVENT_KIND_LABEL, formatEventWhen, plural } from '../labels.ts';
import type { VenueDetail } from '../types.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, Pager, SearchBox, SortTh } from '../ui.tsx';
import { useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';
import { EventDetailModal } from './events.tsx';

const SOURCE_LABEL = { GOOGLE: 'Google', OSM: 'OpenStreetMap', IMPORT: 'Importação de agenda' } as const;

type VenueEvent = VenueDetail['events'][number];

/** Eventos do local, com data e hora para diferenciar os que repetem o nome toda semana. */
function EventList({ events, onOpen }: { events: VenueEvent[]; onOpen: (id: string) => void }) {
  return (
    <ul className="venuedetail__events">
      {events.map((e) => (
        <li key={e.id} className={e.upcoming ? undefined : 'is-past'}>
          <div>
            <button type="button" className="linkbtn" onClick={() => onOpen(e.id)}>
              <strong>{e.title}</strong>
            </button>
            <div className="muted small">
              {formatEventWhen(e.startsAt, e.endsAt)}
              {EVENT_KIND_LABEL[e.kind] ? ` · ${EVENT_KIND_LABEL[e.kind]}` : ''}
            </div>
          </div>
          <span>
            {e.isSample ? <Badge>Teste</Badge> : null} {e.isFree ? <Badge tone="ok">Grátis</Badge> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Detalhe do local: capa e logo, o que o app sabe dele, de onde veio, quem responde e os eventos. */
function VenueDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useAsync(() => api.venue(id), [id]);
  const [eventId, setEventId] = useState<string>();
  const [action, setAction] = useState<ActionSpec>();

  // O evento e a confirmação abrem no lugar do local; ao fechar, voltam para ele (sem buscar de novo).
  if (eventId) return <EventDetailModal id={eventId} onClose={() => setEventId(undefined)} />;
  if (action) {
    return (
      <ActionDialog
        spec={action}
        onClose={() => setAction(undefined)}
        onDone={() => {
          detail.reload();
          onChanged();
        }}
      />
    );
  }

  function removeOwner(venue: VenueDetail) {
    if (!venue.owner) return;
    setAction({
      title: `Tirar o responsável de ${venue.name}`,
      description: <p>@{venue.owner.username} deixa de administrar o local e perde o acesso ao painel dele. Os eventos já criados continuam.</p>,
      confirmLabel: 'Tirar responsável',
      danger: true,
      noteLabel: 'Motivo',
      noteRequired: true,
      run: (note) => api.removeOwner(venue.id, note),
    });
  }

  return (
    <Modal title={detail.data?.name ?? 'Local'} onClose={onClose} wide>
      <Loadable state={detail} empty="Local não encontrado." isEmpty={() => false}>
        {(v) => {
          const upcoming = v.events.filter((e) => e.upcoming);
          const past = v.events.filter((e) => !e.upcoming);
          return (
            <div className="venuedetail">
              {v.coverUrl || v.logoUrl ? (
                <div className={v.logoUrl ? 'venuehead venuehead--logo' : 'venuehead'}>
                  {v.coverUrl ? <img className="venuehead__cover" src={v.coverUrl} alt="" referrerPolicy="no-referrer" /> : <div className="venuehead__cover venuehead__cover--empty" />}
                  {v.logoUrl ? <img className="venuehead__logo" src={v.logoUrl} alt={`Logo de ${v.name}`} referrerPolicy="no-referrer" /> : null}
                </div>
              ) : null}
              <div className="venuedetail__badges">
                {v.owner ? <Badge tone="ok">Com responsável</Badge> : <Badge tone="warn">Sem responsável</Badge>}
                {v.isOrganization ? <Badge tone="info">Organização</Badge> : null}
                {v.isUserCreated ? <Badge tone="info">Criado no app</Badge> : null}
                {v.isSample ? <Badge>Teste</Badge> : null}
              </div>
              <p className="muted small">{v.address ?? 'Sem endereço'}</p>
              <p className="venuedetail__links small">
                <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">
                  Ver no mapa
                </a>
                <a href={appUrl(`/bares/${encodeURIComponent(v.id)}`)} target="_blank" rel="noopener noreferrer">
                  Abrir no app
                </a>
              </p>
              {v.description ? <p className="small eventdetail__desc">{v.description}</p> : null}
              <dl className="venuedetail__facts">
                <div>
                  <dt>Tipo</dt>
                  <dd>{v.category ?? '—'}</dd>
                </div>
                <div>
                  <dt>Entrou por</dt>
                  <dd>{v.source ? SOURCE_LABEL[v.source] : 'Cadastro no app'}</dd>
                </div>
                <div>
                  <dt>Responsável</dt>
                  <dd>
                    {v.owner ? (
                      <>
                        {v.owner.displayName ? `${v.owner.displayName} ` : ''}
                        <span className="handle">@{v.owner.username}</span>
                      </>
                    ) : (
                      <span className="muted">Ninguém</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Seguidores</dt>
                  <dd>{v.followers}</dd>
                </div>
                <div>
                  <dt>Eventos</dt>
                  <dd>
                    {v.eventsTotal} <span className="muted small">({v.upcomingCount} por vir)</span>
                  </dd>
                </div>
                <div>
                  <dt>Posição</dt>
                  <dd className="small">
                    {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                  </dd>
                </div>
              </dl>
              {v.events.length === 0 ? (
                <>
                  <h3 className="venuedetail__h">Eventos</h3>
                  <p className="muted">Nenhum evento neste local.</p>
                </>
              ) : null}
              {upcoming.length > 0 ? (
                <>
                  <h3 className="venuedetail__h">Por vir ({v.upcomingCount})</h3>
                  <EventList events={upcoming} onOpen={setEventId} />
                  {v.upcomingCount > upcoming.length ? <p className="muted small">Mostrando os {upcoming.length} mais próximos.</p> : null}
                </>
              ) : null}
              {past.length > 0 ? (
                <>
                  <h3 className="venuedetail__h">Já passaram ({plural(v.eventsTotal - v.upcomingCount, 'evento', 'eventos')})</h3>
                  <EventList events={past} onOpen={setEventId} />
                  {v.eventsTotal - v.upcomingCount > past.length ? <p className="muted small">Mostrando os {past.length} mais recentes.</p> : null}
                </>
              ) : null}
              <div className="modal__actions modal__actions--split">
                <span>
                  {v.owner ? (
                    <button type="button" className="btn btn--danger-quiet" onClick={() => removeOwner(v)}>
                      Tirar responsável
                    </button>
                  ) : null}
                </span>
                <button type="button" className="btn btn--primary" onClick={onClose}>
                  Fechar
                </button>
              </div>
            </div>
          );
        }}
      </Loadable>
    </Modal>
  );
}

type VenueSort = 'name' | 'category' | 'owner' | 'events';

export function VenuesPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const [openId, setOpenId] = useState<string>();
  const q = useDebounced(text.trim());
  const { sort, toggle } = useSort<VenueSort>();
  const onSort = (column: VenueSort, first: 'asc' | 'desc') => {
    toggle(column, first);
    setOffset(0);
  };
  const list = useAsync(() => api.venues({ q, offset, sort }), [q, offset, sort]);
  return (
    <>
      <PageHead title="Locais" hint="Rolês cadastrados: bares, baladas e casas. Tire o responsável se o pedido foi indevido.">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar por nome ou endereço…" label="Buscar local" />
      </PageHead>
      <Loadable state={list} empty="Nenhum local encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <SortTh label="Local" column="name" sort={sort} onSort={onSort} />
                  <SortTh label="Tipo" column="category" sort={sort} onSort={onSort} />
                  <SortTh label="Responsável" column="owner" sort={sort} onSort={onSort} />
                  <SortTh label="Eventos" column="events" sort={sort} onSort={onSort} first="desc" className="num" />
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button type="button" className="linkbtn" onClick={() => setOpenId(v.id)} aria-label={`Abrir o detalhe de ${v.name}`}>
                        <strong>{v.name}</strong>
                      </button>{' '}
                      {v.isSample ? <Badge>Teste</Badge> : null}
                      <div className="muted small">{v.address ?? 'Sem endereço'}</div>
                    </td>
                    <td>{v.category ?? '—'}</td>
                    <td>{v.owner ? <span className="handle">@{v.owner.username}</span> : <span className="muted">Sem responsável</span>}</td>
                    <td className="num" title={plural(v.eventsCount, 'evento', 'eventos')}>{v.eventsCount}</td>
                    <td className="right">
                      {v.owner ? (
                        <button
                          type="button"
                          className="btn btn--small btn--danger-quiet"
                          onClick={() =>
                            setAction({
                              title: `Tirar o responsável de ${v.name}`,
                              description: <p>@{v.owner?.username} deixa de administrar o local e perde o acesso ao painel dele. Os eventos já criados continuam.</p>,
                              confirmLabel: 'Tirar responsável',
                              danger: true,
                              noteLabel: 'Motivo',
                              noteRequired: true,
                              run: (note) => api.removeOwner(v.id, note),
                            })
                          }
                        >
                          Tirar responsável
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {openId ? <VenueDetailModal id={openId} onClose={() => setOpenId(undefined)} onChanged={list.reload} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
