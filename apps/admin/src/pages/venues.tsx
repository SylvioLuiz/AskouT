import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { plural } from '../labels.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

export function VenuesPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
  const q = useDebounced(text.trim());
  const list = useAsync(() => api.venues({ q, offset }), [q, offset]);
  return (
    <>
      <PageHead title="Locais" hint="Bares, casas e outros lugares cadastrados. Tire o responsável se o pedido foi indevido.">
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
                      <strong>{v.name}</strong> {v.isSample ? <Badge>Teste</Badge> : null}
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
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
