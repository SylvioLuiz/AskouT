import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { formatDateTime } from '../labels.ts';
import { RecordLink } from '../record.tsx';
import type { GoogleVenueHit, GoogleVenueSaveResult, HunterLogState } from '../types.ts';
import { Badge, Loadable } from '../ui.tsx';

const STATUS_BADGE = {
  NEW: { tone: 'ok', text: 'Novo' },
  LINKED: { tone: 'neutral', text: 'Já cadastrado' },
  DUPLICATE: { tone: 'warn', text: 'Já existe com esse nome' },
} as const;

/**
 * Busca locais no Google (busca por texto, até 20 por vez) e grava os escolhidos como locais do AskouT, sem responsável.
 * Os que já estão no AskouT (vinculados ao Google ou com o mesmo nome a menos de 250 m) aparecem marcados e não são gravados.
 */
export function GoogleVenueSearch({ onChange }: { onChange: () => void }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<GoogleVenueHit[]>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'search' | 'save'>();
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<GoogleVenueSaveResult>();

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (q.length < 3) {
      setProblem('Escreva pelo menos 3 letras, por exemplo “bares em Pinheiros”.');
      return;
    }
    setBusy('search');
    setProblem(undefined);
    setSaved(undefined);
    try {
      const r = await api.hunterGoogleSearch(q);
      if (!r.available) setProblem('A busca do Google está indisponível agora (sem chave do Google Places no servidor ou limite do dia atingido). Tente amanhã.');
      setItems(r.items);
      setPicked(new Set(r.items.filter((i) => i.status === 'NEW').map((i) => i.placeId)));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Não foi possível buscar no Google agora.');
    } finally {
      setBusy(undefined);
      onChange();
    }
  }

  async function save() {
    if (!items) return;
    const chosen = items.filter((i) => picked.has(i.placeId) && i.status === 'NEW');
    if (chosen.length === 0) return;
    setBusy('save');
    setProblem(undefined);
    try {
      const r = await api.hunterGoogleSave(chosen);
      setSaved(r);
      const created = new Map(r.results.filter((x) => x.status === 'CREATED').map((x) => [x.placeId, x.venueId!]));
      setItems(items.map((i) => (created.has(i.placeId) ? { ...i, status: 'LINKED', existing: { id: created.get(i.placeId)!, name: i.name } } : i)));
      setPicked(new Set());
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Não foi possível gravar agora.');
    } finally {
      setBusy(undefined);
      onChange();
    }
  }

  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const newOnes = items?.filter((i) => i.status === 'NEW') ?? [];
  const chosenCount = newOnes.filter((i) => picked.has(i.placeId)).length;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <span className="card__label">Buscar locais no Google</span>
      <p className="muted">Procure lugares no Google e grave os novos como locais do AskouT (sem responsável), para o Hunter achar onde publicar. Os que já estão cadastrados aparecem marcados e não são gravados de novo.</p>
      <form onSubmit={(e) => void search(e)} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="search" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: bares em Pinheiros, baladas em Santos" aria-label="Buscar locais no Google" maxLength={120} disabled={!!busy} style={{ flex: '1 1 260px' }} />
        <button type="submit" className="btn btn--primary" disabled={!!busy}>{busy === 'search' ? 'Buscando…' : 'Buscar no Google'}</button>
      </form>
      <p className="muted small">Cada busca traz até 20 lugares e usa a cota diária da busca do Google (a mesma do app). Só nome, endereço, tipo e posição; capa, logo e Instagram você completa no local.</p>
      {problem ? <p className="notice notice--warn" role="alert">{problem}</p> : null}
      {saved ? (
        <p className="notice" role="status">
          {saved.created} local(is) gravado(s){saved.skipped ? `, ${saved.skipped} pulado(s): ${saved.results.filter((r) => r.status === 'SKIPPED').map((r) => `${r.name || 'sem nome'} (${r.reason ?? 'já existe'})`).join('; ')}` : ''}.
        </p>
      ) : null}
      {items && items.length === 0 && !problem ? <p className="muted">O Google não achou nada com esse texto.</p> : null}
      {items && items.length > 0 ? (
        <>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th scope="col" aria-label="Gravar" />
                <th scope="col">Lugar</th>
                <th scope="col">Tipo</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.placeId}>
                  <td>
                    {i.status === 'NEW' ? <input type="checkbox" checked={picked.has(i.placeId)} onChange={() => toggle(i.placeId)} aria-label={`Gravar ${i.name}`} disabled={!!busy} /> : null}
                  </td>
                  <td>
                    <strong>{i.name}</strong>
                    <div className="muted small">
                      {i.address ?? 'Sem endereço'}
                      {i.mapsUri ? (
                        <>
                          {' · '}
                          <a href={i.mapsUri} target="_blank" rel="noopener noreferrer">Ver no Google Maps</a>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td>{i.category ?? '—'}</td>
                  <td>
                    <Badge tone={STATUS_BADGE[i.status].tone}>{STATUS_BADGE[i.status].text}</Badge>
                    {i.existing ? (
                      <div className="small">
                        <RecordLink kind="venue" id={i.existing.id}>{i.existing.name}</RecordLink>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!!busy || chosenCount === 0}>
              {busy === 'save' ? 'Gravando…' : `Gravar ${chosenCount} local(is) novo(s)`}
            </button>
            {newOnes.length > 0 ? (
              <button type="button" className="btn btn--small" onClick={() => setPicked(chosenCount === newOnes.length ? new Set() : new Set(newOnes.map((i) => i.placeId)))} disabled={!!busy}>
                {chosenCount === newOnes.length ? 'Desmarcar todos' : 'Marcar todos os novos'}
              </button>
            ) : null}
          </p>
        </>
      ) : null}
    </div>
  );
}

const KIND_LABEL = { SYNC: 'Busca no Hunter', GOOGLE_SEARCH: 'Busca no Google', GOOGLE_SAVE: 'Gravação do Google' } as const;
const ENGINE_LABEL: Record<string, string> = { 'gemini-busca': 'Busca com IA (Gemini)', rodada: 'Rodada inteira' };
const DECISION_LABEL: Record<string, string> = { PUBLISH: 'aprovado', REVIEW: 'para revisar', NO_VENUE: 'sem local', REJECTED: 'rejeitado', PUBLISHED: 'publicado' };

interface LogRow { at: string; where: string; how: string; what: string; result: string; tone: 'ok' | 'bad' | 'neutral' }

function rowsOf(s: HunterLogState): LogRow[] {
  const own: LogRow[] = s.entries.map((e) => ({
    at: e.at, where: 'Gestão', how: e.trigger === 'AUTO' ? 'Automática' : 'Manual', what: KIND_LABEL[e.kind],
    result: e.error ? `${e.summary}: ${e.error}` : e.summary, tone: e.error ? 'bad' : 'ok',
  }));
  const hunter: LogRow[] = (s.hunter?.runs ?? []).map((r) => {
    const dec = Object.entries(r.byDecision).map(([k, v]) => `${v} ${DECISION_LABEL[k] ?? k}`).join(', ');
    const result = r.error
      ? `Erro: ${r.error}`
      : r.note ?? `${r.found} achado(s)${r.skippedNiche ? `, ${r.skippedNiche} fora do nicho` : ''}${r.skippedArea ? `, ${r.skippedArea} fora das regiões` : ''}${dec ? ` (${dec})` : ''}`;
    return { at: r.startedAt, where: 'Hunter', how: r.trigger === 'manual' ? 'Manual' : 'Agendada', what: ENGINE_LABEL[r.engine] ?? r.engine, result, tone: r.error ? 'bad' : r.note ? 'neutral' : 'ok' };
  });
  return [...own, ...hunter].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Registro de cada busca: as da gestão (busca no Hunter, busca no Google) e as rodadas do próprio Hunter, com o resultado ou o erro. */
export function HunterRunLog({ tick }: { tick: number }) {
  const state = useAsync(() => api.hunterLog(), [tick]);
  return (
    <>
      <h2 className="section">Registro das buscas</h2>
      <Loadable state={state} empty="Sem registro." isEmpty={() => false}>
        {(s) => {
          const rows = rowsOf(s).slice(0, 120);
          const sched = s.hunter?.schedule;
          return (
            <>
              {s.hunterError ? <p className="notice notice--warn" role="alert">Rodadas do Hunter indisponíveis: {s.hunterError}</p> : null}
              {s.hunter ? (
                <p className="muted small">
                  Última rodada do Hunter: {s.hunter.lastRun ? formatDateTime(s.hunter.lastRun) : 'ainda não rodou'}
                  {sched ? ` · agendada ${sched.enabled ? `às ${sched.hours.map((h) => `${h}h`).join(' e ')} (São Paulo)` : 'desligada no painel do Hunter'}` : ''}
                </p>
              ) : null}
              {rows.length === 0 ? (
                <p className="muted">Nenhuma busca registrada ainda.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Quando</th>
                      <th scope="col">Onde</th>
                      <th scope="col">Como</th>
                      <th scope="col">Busca</th>
                      <th scope="col">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.at}-${i}`}>
                        <td>{formatDateTime(r.at)}</td>
                        <td>{r.where}</td>
                        <td>{r.how}</td>
                        <td>{r.what}</td>
                        <td className={r.tone === 'bad' ? 'alert' : r.tone === 'neutral' ? 'muted' : undefined}>{r.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted small">A busca automática da gestão (a cada 10 minutos) só entra aqui quando acha algo ou falha.</p>
            </>
          );
        }}
      </Loadable>
    </>
  );
}
