import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { formatDateTime, plural } from '../labels.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, Pager, SearchBox } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

const SOURCE_LABEL = { GOOGLE: 'Google', OSM: 'OpenStreetMap', IMPORT: 'Importação de agenda' } as const;

/** Detalhe do local: o que o app sabe dele, de onde veio, quem responde e os eventos. */
function VenueDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAsync(() => api.venue(id), [id]);
  return (
    <Modal title={detail.data?.name ?? 'Local'} onClose={onClose} wide>
      <Loadable state={detail} empty="Local não encontrado." isEmpty={() => false}>
        {(v) => (
          <div className="venuedetail">
            <p className="muted small">
              {v.address ?? 'Sem endereço'}
              {' · '}
              <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noopener noreferrer">
                Ver no mapa
              </a>
            </p>
            <p>
              {v.isSample ? <Badge>Teste</Badge> : null} {v.isOrganization ? <Badge tone="info">Organização</Badge> : null} {v.isUserCreated ? <Badge tone="info">Criado no app</Badge> : null}
            </p>
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
                <dd>{v.owner ? <span className="handle">@{v.owner.username}</span> : <span className="muted">Sem responsável</span>}</dd>
              </div>
              <div>
                <dt>Seguidores</dt>
                <dd>{v.followers}</dd>
              </div>
              <div>
                <dt>Eventos</dt>
                <dd>
                  {v.eventsTotal} ({v.upcomingCount} por vir)
                </dd>
              </div>
              <div>
                <dt>Posição</dt>
                <dd>
                  {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                </dd>
              </div>
            </dl>
            {v.description ? <p className="small">{v.description}</p> : null}
            <h3 className="venuedetail__h">Eventos</h3>
            {v.events.length === 0 ? (
              <p className="muted">Nenhum evento neste local.</p>
            ) : (
              <ul className="venuedetail__events">
                {v.events.map((e) => (
                  <li key={e.id} className={e.upcoming ? undefined : 'muted'}>
                    <strong>{e.title}</strong> {e.isSample ? <Badge>Teste</Badge> : null} {e.isFree ? <Badge tone="ok">Grátis</Badge> : null}
                    <div className="small">{formatDateTime(e.startsAt)}{e.upcoming ? '' : ' · já passou'}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Loadable>
    </Modal>
  );
}

export function VenuesPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const [openId, setOpenId] = useState<string>();
  const q = useDebounced(text.trim());
  const list = useAsync(() => api.venues({ q, offset }), [q, offset]);
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
                  <th>Local</th>
                  <th>Tipo</th>
                  <th>Responsável</th>
                  <th className="num">Eventos</th>
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
      {openId ? <VenueDetailModal id={openId} onClose={() => setOpenId(undefined)} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
