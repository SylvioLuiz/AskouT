import { useState } from 'react';
import { api, appUrl } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { EVENT_KIND_LABEL, formatDateTime } from '../labels.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, Pager, SearchBox } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

const STATUS_LABEL = { UPCOMING: 'Por vir', LIVE: 'Acontecendo agora', PAST: 'Já passou' } as const;

/** Detalhe do evento: o que foi cadastrado, o local, quem responde por ele e quem confirmou presença. */
function EventDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAsync(() => api.placeEvent(id), [id]);
  return (
    <Modal title={detail.data?.title ?? 'Evento'} onClose={onClose} wide>
      <Loadable state={detail} empty="Evento não encontrado." isEmpty={() => false}>
        {(e) => (
          <div className="venuedetail">
            <p className="muted small">
              {e.venue.name}
              {e.venue.address ? ` · ${e.venue.address}` : ''}
              {' · '}
              <a href={appUrl(`/eventos/${encodeURIComponent(e.id)}`)} target="_blank" rel="noopener noreferrer">
                Abrir no app
              </a>
            </p>
            <p>
              <Badge tone={e.status === 'PAST' ? undefined : 'info'}>{STATUS_LABEL[e.status]}</Badge> {e.isSample ? <Badge>Teste</Badge> : null} {e.isFree ? <Badge tone="ok">Grátis</Badge> : null}
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
                <dt>Tipo</dt>
                <dd>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</dd>
              </div>
              <div>
                <dt>Responsável pelo local</dt>
                <dd>{e.venue.owner ? <span className="handle">@{e.venue.owner.username}</span> : <span className="muted">Sem responsável</span>}</dd>
              </div>
              <div>
                <dt>Confirmados</dt>
                <dd>{e.goingCount}</dd>
              </div>
              <div>
                <dt>Ingresso</dt>
                <dd>
                  {e.ticketUrl ? (
                    <a href={e.ticketUrl} target="_blank" rel="noopener noreferrer">
                      Link de compra
                    </a>
                  ) : (
                    <span className="muted">Sem link</span>
                  )}
                </dd>
              </div>
            </dl>
            {e.description ? <p className="small eventdetail__desc">{e.description}</p> : null}
            {e.tags.length > 0 ? <p className="small muted">{e.tags.map((tag) => `#${tag}`).join(' ')}</p> : null}
            <h3 className="venuedetail__h">Quem confirmou</h3>
            {e.going.length === 0 ? (
              <p className="muted">Ninguém confirmou ainda.</p>
            ) : (
              <ul className="venuedetail__events">
                {e.going.map((g) => (
                  <li key={g.id}>
                    <span className="handle">@{g.username}</span> {g.displayName ? <span className="muted small">{g.displayName}</span> : null}
                    <div className="small muted">Confirmou em {formatDateTime(g.at)}</div>
                  </li>
                ))}
                {e.goingCount > e.going.length ? <li className="muted small">e mais {e.goingCount - e.going.length}</li> : null}
              </ul>
            )}
          </div>
        )}
      </Loadable>
    </Modal>
  );
}

export function EventsPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const [openId, setOpenId] = useState<string>();
  const q = useDebounced(text.trim());
  const list = useAsync(() => api.placeEvents({ q, offset }), [q, offset]);
  return (
    <>
      <PageHead title="Eventos" hint="Eventos de locais. Os eventos criados por pessoas aparecem em Posts (filtro “só eventos”).">
        <SearchBox value={text} onChange={(v) => { setText(v); setOffset(0); }} placeholder="Buscar por evento ou local…" label="Buscar evento" />
      </PageHead>
      <Loadable state={list} empty="Nenhum evento encontrado." isEmpty={(d) => d.items.length === 0}>
        {(page) => (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Local</th>
                  <th>Início</th>
                  <th>Tipo</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <button type="button" className="linkbtn" onClick={() => setOpenId(e.id)} aria-label={`Abrir o detalhe de ${e.title}`}>
                        <strong>{e.title}</strong>
                      </button>{' '}
                      {e.isSample ? <Badge>Teste</Badge> : null}
                    </td>
                    <td>{e.venue.name}</td>
                    <td>{formatDateTime(e.startsAt)}</td>
                    <td>{EVENT_KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td className="right">
                      <button
                        type="button"
                        className="btn btn--small btn--danger-quiet"
                        onClick={() =>
                          setAction({
                            title: `Apagar “${e.title}”`,
                            description: <p>O evento some do Explorar e das páginas de quem já o viu. Isso não pode ser desfeito.</p>,
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
                ))}
              </tbody>
            </table>
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} total={page.total} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {openId ? <EventDetailModal id={openId} onClose={() => setOpenId(undefined)} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
