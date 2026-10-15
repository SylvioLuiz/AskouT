import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { EVENT_KIND_LABEL, formatDateTime } from '../labels.ts';
import { ActionDialog, Badge, Loadable, PageHead, Pager, SearchBox } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

export function EventsPage() {
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<ActionSpec>();
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
                      <strong>{e.title}</strong> {e.isSample ? <Badge>Teste</Badge> : null}
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
            <Pager offset={page.offset} limit={page.limit} hasMore={page.hasMore} onChange={setOffset} />
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={list.reload} /> : null}
    </>
  );
}
