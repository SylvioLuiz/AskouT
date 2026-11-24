import { useId, useState } from 'react';
import { api } from '../api.ts';
import type { VenueImportLine, VenueImportResult } from '../types.ts';
import { Badge, CHANGED_EVENT, Modal } from '../ui.tsx';
import { plural } from '../labels.ts';
import { readSpreadsheet, writeXlsx } from '../xlsx.ts';
import { VENUE_COLUMNS, venueRowsFromSheet, venueTemplate } from '../venue-import.ts';
import type { VenueImportRow } from '../venue-import.ts';

const MAX_ROWS = 200;

/** Nome da coluna da planilha para cada campo que a API recusou. */
const FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(VENUE_COLUMNS.map((c) => [c.key, c.header])),
  image: 'Capa',
  imageData: 'Capa',
  logoData: 'Logo',
  row: 'Linha',
  venue: 'Linha',
  profile: 'Linha',
};

const LOCATED = { SHEET: 'da planilha', FREE: 'pelo endereço (OpenStreetMap)', GOOGLE: 'pelo endereço (Google)' } as const;

function downloadTemplate() {
  const bytes = writeXlsx(venueTemplate());
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-importar-locais.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatusBadge({ status }: { status: VenueImportLine['status'] }) {
  if (status === 'OK') return <Badge tone="ok">Pronto</Badge>;
  if (status === 'CREATED') return <Badge tone="ok">Criado</Badge>;
  if (status === 'DUPLICATE') return <Badge tone="warn">Duplicado</Badge>;
  return <Badge tone="bad">Erro</Badge>;
}

interface Parsed {
  fileName: string;
  rows: VenueImportRow[];
  /** Linha da planilha de cada item de `rows`. */
  lines: number[];
  unknownColumns: string[];
}

/**
 * Importar locais de planilha: baixar o modelo, anexar o arquivo, ver a prévia linha a linha (erros por coluna e
 * duplicados) e importar só o que está certo.
 */
export function ImportVenuesModal({ onClose, onImported, onOpen }: { onClose: () => void; onImported: () => void; onOpen: (venueId: string) => void }) {
  const fileId = useId();
  const noteId = useId();
  const [parsed, setParsed] = useState<Parsed>();
  const [preview, setPreview] = useState<VenueImportResult>();
  const [done, setDone] = useState<VenueImportResult>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'reading' | 'checking' | 'importing'>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<'all' | 'problems'>('all');

  const reset = () => {
    setParsed(undefined);
    setPreview(undefined);
    setDone(undefined);
    setError(undefined);
    setFilter('all');
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setBusy('reading');
    try {
      const sheet = await readSpreadsheet(file);
      const r = venueRowsFromSheet(sheet);
      if (r.error) throw new Error(r.error);
      if (r.rows.length === 0) throw new Error('A planilha não tem nenhum local abaixo do cabeçalho.');
      if (r.rows.length > MAX_ROWS) throw new Error(`A planilha tem ${r.rows.length} locais. Importe até ${MAX_ROWS} por vez (divida em mais arquivos).`);
      const p: Parsed = { fileName: file.name, rows: r.rows, lines: r.lines, unknownColumns: r.unknownColumns };
      setParsed(p);
      setBusy('checking');
      setPreview(await api.importVenues({ rows: p.rows as Record<string, string>[], dryRun: true, fileName: p.fileName }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      setBusy(undefined);
    }
  };

  /** Número da linha na planilha (a API conta a partir de 2, na ordem enviada). */
  const sheetLine = (apiLine: number, lines: number[]) => lines[apiLine - 2] ?? apiLine;

  const confirm = async () => {
    if (!parsed || !preview) return;
    // Só as linhas prontas, já com a posição achada na prévia (não busca o endereço de novo).
    const ready = preview.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.status === 'OK');
    const rows = ready.map(({ l, i }) => ({ ...parsed.rows[i], ...(l.lat !== null && l.lng !== null ? { lat: String(l.lat), lng: String(l.lng) } : {}) }));
    const lines = ready.map(({ i }) => parsed.lines[i]!);
    setBusy('importing');
    setError(undefined);
    try {
      const result = await api.importVenues({ rows: rows as Record<string, string>[], dryRun: false, fileName: parsed.fileName, ...(note.trim() ? { note: note.trim() } : {}) });
      // Volta os números de linha para os da planilha.
      setDone({ ...result, lines: result.lines.map((l) => ({ ...l, line: lines[l.line - 2] ?? l.line })) });
      window.dispatchEvent(new Event(CHANGED_EVENT));
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível importar agora.');
    } finally {
      setBusy(undefined);
    }
  };

  const shownPreview = preview && parsed ? { ...preview, lines: preview.lines.map((l) => ({ ...l, line: sheetLine(l.line, parsed.lines), duplicateOf: l.duplicateOf?.line ? { ...l.duplicateOf, line: sheetLine(l.duplicateOf.line, parsed.lines) } : l.duplicateOf })) } : undefined;
  const result = done ?? shownPreview;
  const visible = result ? (filter === 'problems' ? result.lines.filter((l) => l.status === 'ERROR' || l.status === 'DUPLICATE') : result.lines) : [];

  return (
    <Modal title="Importar locais de planilha" onClose={onClose} wide>
      {!done ? (
        <>
          <p className="muted">
            Baixe o modelo, preencha uma linha por local e anexe o arquivo (.xlsx ou .csv). Antes de gravar, mostramos a prévia de cada linha: só as
            prontas entram; erros e duplicados (mesmo nome a menos de 250 m) ficam de fora.
          </p>
          <div className="import__steps">
            <div className="import__step">
              <span className="import__num">1</span>
              <div>
                <strong>Modelo</strong>
                <p className="muted small">Colunas: {VENUE_COLUMNS.map((c) => c.header).join(', ')}. Só “Nome” é obrigatório, junto com o endereço ou a latitude e longitude.</p>
                <button type="button" className="btn btn--small" onClick={downloadTemplate}>
                  Baixar modelo (.xlsx)
                </button>
              </div>
            </div>
            <div className="import__step">
              <span className="import__num">2</span>
              <div>
                <strong>Arquivo</strong>
                <p className="muted small">{parsed ? `${parsed.fileName} · ${plural(parsed.rows.length, 'local', 'locais')}` : `Até ${MAX_ROWS} locais por arquivo.`}</p>
                <label className="btn btn--small" htmlFor={fileId} aria-busy={busy === 'reading' || busy === 'checking' || undefined}>
                  <span>{parsed ? 'Trocar arquivo' : 'Anexar planilha'}</span>
                </label>
                <input
                  id={fileId}
                  className="visually-hidden"
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  disabled={busy !== undefined}
                  onChange={(e) => {
                    void pick(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          </div>
          {busy === 'checking' ? <p className="notice">Conferindo as linhas e buscando a posição dos endereços…</p> : null}
          {parsed && parsed.unknownColumns.length > 0 ? <p className="notice notice--warn">Colunas ignoradas (fora do modelo): {parsed.unknownColumns.join(', ')}.</p> : null}
        </>
      ) : (
        <p className="notice">
          {plural(done.counts.created, 'local criado', 'locais criados')}. Cada um ficou registrado na auditoria. Abra um local para completar capa, logo e horários.
        </p>
      )}
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <>
          <div className="import__summary">
            {!done ? (
              <>
                <Badge tone="ok">{plural(result.counts.ok, 'pronto', 'prontos')}</Badge> <Badge tone="warn">{plural(result.counts.duplicates, 'duplicado', 'duplicados')}</Badge>{' '}
                <Badge tone="bad">{plural(result.counts.errors, 'com erro', 'com erro')}</Badge>
              </>
            ) : null}
            {!done && result.counts.errors + result.counts.duplicates > 0 ? (
              <label className="small import__filter">
                <input type="checkbox" checked={filter === 'problems'} onChange={(e) => setFilter(e.target.checked ? 'problems' : 'all')} /> Só as linhas com problema
              </label>
            ) : null}
          </div>
          <div className="import__table">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Linha</th>
                  <th>Local</th>
                  <th>Posição</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.line}>
                    <td className="num">{l.line}</td>
                    <td>
                      {l.venueId ? (
                        <button type="button" className="linkbtn" onClick={() => onOpen(l.venueId!)}>
                          <strong>{l.name}</strong>
                        </button>
                      ) : (
                        <strong>{l.name || <span className="muted">(sem nome)</span>}</strong>
                      )}
                      <div className="muted small">{l.address ?? 'Sem endereço'}</div>
                    </td>
                    <td className="small">
                      {l.lat !== null && l.lng !== null ? (
                        <>
                          <a href={`https://www.google.com/maps?q=${l.lat},${l.lng}`} target="_blank" rel="noopener noreferrer" className="mono">
                            {l.lat.toFixed(5)}, {l.lng.toFixed(5)}
                          </a>
                          {l.located ? <div className="muted">{LOCATED[l.located]}</div> : null}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={l.status} />
                      {l.duplicateOf ? (
                        <div className="small muted">
                          {l.duplicateOf.id ? (
                            <>
                              Já existe:{' '}
                              <button type="button" className="linkbtn" onClick={() => onOpen(l.duplicateOf!.id!)}>
                                {l.duplicateOf.name}
                              </button>
                            </>
                          ) : (
                            `Repete a linha ${l.duplicateOf.line}`
                          )}
                        </div>
                      ) : null}
                      {Object.entries(l.problems).map(([k, v]) => (
                        <div key={k} className="small alert">
                          {FIELD_LABEL[k] ?? k}: {v}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!done ? (
            <div className="field">
              <label htmlFor={noteId}>Motivo (opcional)</label>
              <textarea id={noteId} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: lista de parceiros do comercial" />
              <span className="muted small">Fica registrado na auditoria com o resumo da importação.</span>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="modal__actions">
        {done ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Fechar
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose} disabled={busy === 'importing'}>
              Cancelar
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void confirm()} disabled={!preview || preview.counts.ok === 0 || busy !== undefined} aria-busy={busy === 'importing' || undefined}>
              <span>{preview && preview.counts.ok > 0 ? `Importar ${plural(preview.counts.ok, 'local', 'locais')}` : 'Importar'}</span>
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
