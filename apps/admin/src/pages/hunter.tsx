import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { formatDateTime } from '../labels.ts';
import type { HunterOverview } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead, SortTh } from '../ui.tsx';
import { sortRows, useSort } from '../sort.ts';
import type { ActionSpec } from '../ui.tsx';
import { RecordLink } from '../record.tsx';
import { GoogleVenueSearch, HunterRunLog } from './hunter-google.tsx';

/**
 * Aba do Hunter (sistema separado que descobre e publica eventos). Aqui a gestão liga e desliga a ponte e vê, e pode remover,
 * tudo o que o Hunter cadastrou no app. Desligado, a API recusa o Hunter na hora; o que já foi publicado continua até ser removido.
 */
export function HunterPage() {
  const state = useAsync(() => api.hunter(100, 0), []);
  const { sort, toggle } = useSort<'title' | 'venue' | 'startsAt' | 'createdAt'>();
  const [action, setAction] = useState<ActionSpec>();
  const [syncMsg, setSyncMsg] = useState<string>();
  const [syncing, setSyncing] = useState(false);
  const [logTick, setLogTick] = useState(0);
  const refreshLog = () => setLogTick((t) => t + 1);

  async function syncNow() {
    setSyncing(true);
    setSyncMsg(undefined);
    try {
      const r = await api.syncHunter();
      setSyncMsg(r.error ? r.error : `Publicados ${r.published ?? 0}, devolvidos para revisão ${r.review ?? 0}, descartados por duplicidade ${r.rejected ?? 0}.`);
      state.reload();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Não foi possível buscar agora.');
    } finally {
      setSyncing(false);
      refreshLog();
    }
  }

  function turnOn() {
    setAction({
      title: 'Ligar o Hunter',
      description: (
        <>
          <p>O Hunter passa a poder publicar eventos no app, apenas em locais que ainda não têm responsável nem pedido de reivindicação pendente.</p>
          <p className="muted small">Você pode desligar quando quiser; vale na hora.</p>
        </>
      ),
      confirmLabel: 'Ligar Hunter',
      run: () => api.setHunter(true),
    });
  }

  function turnOff() {
    setAction({
      title: 'Desligar o Hunter',
      description: (
        <>
          <p>A API passa a recusar o Hunter agora: ele não cria, atualiza nem remove nada.</p>
          <p className="muted small">Os eventos que ele já publicou continuam no app até você removê-los aqui.</p>
        </>
      ),
      confirmLabel: 'Desligar Hunter',
      danger: true,
      run: () => api.setHunter(false),
    });
  }

  function removeOne(item: HunterOverview['items'][number]) {
    setAction({
      title: 'Remover evento do Hunter',
      description: <p>Apagar <strong>{item.title}</strong> ({item.venueName}) do app? Quem confirmou presença deixa de vê-lo.</p>,
      confirmLabel: 'Remover evento',
      danger: true,
      noteLabel: 'Motivo',
      run: () => api.removeHunterEvent(item.ref),
    });
  }

  function removeAll(total: number) {
    setAction({
      title: 'Remover tudo o que o Hunter cadastrou',
      description: (
        <>
          <p>Apagar do app os <strong>{total}</strong> evento(s) cadastrados pelo Hunter? Isso não dá para desfazer.</p>
          <p className="muted small">Eventos criados por donos de local ou por pessoas não são afetados.</p>
        </>
      ),
      confirmLabel: 'Remover tudo',
      danger: true,
      noteLabel: 'Motivo',
      run: () => api.removeAllHunterEvents(),
    });
  }

  return (
    <>
      <PageHead title="Hunter" hint="Liga e desliga o Hunter, busca locais no Google, mostra o registro de cada busca e tudo o que ele cadastrou no app." />
      <Loadable state={state} empty="Sem dados." isEmpty={() => false}>
        {(s) => (
          <>
            <div className="card" style={{ maxWidth: 560 }}>
              <span className="card__label">Publicação automática de eventos</span>
              <p style={{ margin: '4px 0' }}>
                <Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'Ligado' : 'Desligado'}</Badge>
              </p>
              <p className="muted">{s.enabled ? 'A gestão pode publicar o que o Hunter aprovou, nos locais sem responsável.' : 'O Hunter está barrado: a API recusa tudo que ele pedir.'}</p>
              <div>
                {s.enabled ? (
                  <button type="button" className="btn btn--danger" onClick={turnOff}>
                    Desligar Hunter
                  </button>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={turnOn} disabled={!s.serviceConfigured}>
                    Ligar Hunter
                  </button>
                )}
              </div>
            </div>
            <div className="card" style={{ maxWidth: 560, marginTop: 12 }}>
              <span className="card__label">Busca no Hunter</span>
              <p className="muted">A gestão busca sozinha, a cada 10 minutos, o que foi aprovado no Hunter e publica nos locais sem responsável. O Hunter só descobre e separa.</p>
              {s.lastSync ? <p className="muted small">Última busca: {new Date(s.lastSync.at).toLocaleString('pt-BR')}{s.lastSync.error ? ` — erro: ${s.lastSync.error}` : ` — publicados ${s.lastSync.published}, revisão ${s.lastSync.review}, duplicados ${s.lastSync.rejected}`}</p> : null}
              <div>
                <button type="button" className="btn btn--primary" onClick={() => void syncNow()} disabled={!s.enabled || !s.feedConfigured || syncing}>
                  {syncing ? 'Buscando…' : 'Buscar agora'}
                </button>
              </div>
              {syncMsg ? <p role="status" className="muted small">{syncMsg}</p> : null}
              {!s.feedConfigured ? <p className="notice notice--warn" role="alert">O servidor ainda não sabe onde está o Hunter (HUNTER_URL e HUNTER_EXPORT_TOKEN, 32 caracteres ou mais).</p> : null}
            </div>
            <div style={{ maxWidth: 900 }}>
              <GoogleVenueSearch onChange={refreshLog} />
            </div>
            {!s.serviceConfigured ? <p className="notice notice--warn" role="alert">O servidor ainda não tem a credencial do Hunter (HUNTER_SERVICE_TOKEN, 32 caracteres ou mais). Sem ela o Hunter não liga.</p> : null}

            <h2 className="section">Eventos cadastrados pelo Hunter ({s.total})</h2>
            {s.items.length === 0 ? (
              <p className="muted">O Hunter ainda não cadastrou nenhum evento.</p>
            ) : (
              <>
                <table className="table">
                  <thead>
                    <tr>
                      <SortTh label="Evento" column="title" sort={sort} onSort={toggle} />
                      <SortTh label="Local" column="venue" sort={sort} onSort={toggle} />
                      <SortTh label="Quando" column="startsAt" sort={sort} onSort={toggle} first="desc" />
                      <SortTh label="Cadastrado em" column="createdAt" sort={sort} onSort={toggle} first="desc" />
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(s.items, sort, { title: (i) => i.title, venue: (i) => i.venueName, startsAt: (i) => Date.parse(i.startsAt), createdAt: (i) => Date.parse(i.createdAt) }).map((i) => (
                      <tr key={i.ref}>
                        <td>
                          <RecordLink kind="event" id={i.eventId}>{i.title}</RecordLink>
                        </td>
                        <td>
                          <RecordLink kind="venue" id={i.venueId}>{i.venueName}</RecordLink>
                        </td>
                        <td>{formatDateTime(i.startsAt)}</td>
                        <td>{formatDateTime(i.createdAt)}</td>
                        <td><button type="button" className="btn btn--danger" onClick={() => removeOne(i)}>Remover</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.total > s.items.length ? <p className="muted small">Mostrando os {s.items.length} mais recentes de {s.total}.</p> : null}
                <p><button type="button" className="btn btn--danger" onClick={() => removeAll(s.total)}>Remover tudo o que o Hunter cadastrou</button></p>
              </>
            )}
            <HunterRunLog tick={logTick} />
            <p className="muted small">Cada mudança fica na Auditoria, com quem fez e o motivo.</p>
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={state.reload} /> : null}
    </>
  );
}
