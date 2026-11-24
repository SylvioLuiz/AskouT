import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, avatarSrc } from './api.ts';
import { saveBlocker, splitProblems } from './editor-check.ts';
import type { Async } from './hooks.ts';
import { ActionDialog, CHANGED_EVENT, Modal } from './ui.tsx';
import type { ActionSpec } from './ui.tsx';

/**
 * Padrão único das telas de detalhe e edição da gestão.
 *
 * - `RecordView`: cabeçalho (título, situação e ações), seções agrupadas de campos e os modos ver/editar, com o mesmo
 *   jeito de salvar e cancelar em todas as telas (motivo obrigatório, que vai para a auditoria).
 * - `useRecordEditor`: o rascunho da edição (o que mudou, salvar, cancelar, erro).
 * - `RecordsProvider` / `RecordLink`: abre o detalhe de qualquer registro (pessoa, local, evento, post) por cima da tela,
 *   e volta para o anterior ao fechar.
 */

// ---------- Rascunho da edição ----------

export interface RecordEditor<D extends Record<string, unknown>> {
  editing: boolean;
  draft: D;
  set: <K extends keyof D>(key: K, value: D[K]) => void;
  /** Campos com valor diferente do salvo. */
  changed: (keyof D)[];
  start: () => void;
  cancel: () => void;
  save: () => Promise<void>;
  note: string;
  setNote: (note: string) => void;
  noteMissing: boolean;
  /** Pede o motivo ao salvar (vai para a auditoria). */
  noteRequired: boolean;
  busy: boolean;
  error: string | undefined;
  /** Problemas por campo (da API ou da conferência local); bloqueiam o salvar. */
  problems: Partial<Record<keyof D, string>>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * `initial` é o que está salvo agora (refeito a cada carga). `save` recebe só os campos que mudaram e o motivo.
 * `check` confere o rascunho antes de salvar (ex.: fim antes do início) e devolve os problemas por campo.
 */
export function useRecordEditor<D extends Record<string, unknown>>({ initial, save, check, onSaved, noteRequired = true, startEditing = false, labels = {}, alias = {} }: {
  initial: D;
  /** Nome de cada campo, para o aviso quando algo impede o salvar. */
  labels?: Partial<Record<keyof D, string>>;
  /** Campo da API que corresponde a outro campo da tela (ex.: `image` → `imageData`). */
  alias?: Record<string, keyof D & string>;
  noteRequired?: boolean;
  /** Registro novo: abre direto no modo de editar. */
  startEditing?: boolean;
  save: (changes: Partial<D>, note: string, draft: D) => Promise<unknown>;
  check?: (draft: D) => Partial<Record<keyof D, string>>;
  onSaved?: () => void;
}): RecordEditor<D> {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState<D>(initial);
  const [note, setNoteRaw] = useState('');
  const [noteMissing, setNoteMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [apiProblems, setApiProblems] = useState<Partial<Record<keyof D, string>>>({});
  const key = JSON.stringify(initial);

  // Enquanto não edita, o rascunho acompanha o que está salvo (depois de recarregar, por exemplo).
  useEffect(() => {
    if (!editing) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, editing]);

  const changed = (Object.keys(initial) as (keyof D)[]).filter((k) => !same(initial[k], draft[k]));
  const problems = { ...(check ? check(draft) : {}), ...apiProblems };

  return {
    editing,
    draft,
    set: (k, v) => {
      setDraft((d) => ({ ...d, [k]: v }));
      setError(undefined);
      setApiProblems((p) => {
        if (!(k in p)) return p;
        const next = { ...p };
        delete next[k];
        return next;
      });
    },
    changed,
    start: () => {
      setDraft(initial);
      setNoteRaw('');
      setNoteMissing(false);
      setError(undefined);
      setApiProblems({});
      setEditing(true);
    },
    cancel: () => {
      setDraft(initial);
      setError(undefined);
      setApiProblems({});
      setEditing(false);
    },
    save: async () => {
      if (busy) return;
      // Nunca fica mudo: sem mudança ou com problema (às vezes num campo fora da vista), diz o que falta.
      const blocker = saveBlocker(changed.length, problems as Record<string, string | undefined>, labels as Record<string, string>);
      if (blocker) {
        setError(blocker);
        return;
      }
      if (noteRequired && note.trim() === '') {
        setNoteMissing(true);
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const changes: Partial<D> = {};
        for (const k of changed) changes[k] = draft[k];
        await save(changes, note.trim(), draft);
        setEditing(false);
        window.dispatchEvent(new Event(CHANGED_EVENT));
        onSaved?.();
      } catch (e) {
        if (e instanceof ApiError) {
          // Problema de campo que a tela não mostra (ex.: `image`) vai no aviso, para não travar o salvar sem explicação.
          const { byField, loose } = splitProblems(e.fields, Object.keys(initial), alias);
          setError(loose.length > 0 ? `${e.message}: ${loose.join(' · ')}` : e.message);
          setApiProblems(byField as Partial<Record<keyof D, string>>);
        } else setError('Algo deu errado. Tente de novo.');
      } finally {
        setBusy(false);
      }
    },
    note,
    setNote: (v) => {
      setNoteRaw(v);
      if (v.trim() !== '') setNoteMissing(false);
    },
    noteMissing,
    noteRequired,
    busy,
    error,
    problems,
  };
}

// ---------- Campos ----------

/** O id do campo em edição: os controles abaixo o usam, para o rótulo ficar ligado a eles. */
const FieldIdContext = createContext<string | undefined>(undefined);

export interface RecordField {
  label: string;
  /** Como aparece no modo de ver (vazio mostra "—"). */
  value: ReactNode;
  /** Campo editável: o controle mostrado no modo de editar. Sem ele, o campo fica só para leitura. */
  input?: ReactNode;
  /** Ocupa a linha inteira (textos longos, listas). */
  wide?: boolean;
  /** Texto de ajuda embaixo do controle no modo de editar. */
  hint?: string;
  /** Problema do campo no modo de editar. */
  problem?: string;
  /** Some da tela (campo que não se aplica a este registro). */
  hidden?: boolean;
}

export interface RecordSection {
  title: string;
  fields?: RecordField[];
  /** Conteúdo livre (listas ligadas, fotos), embaixo dos campos. */
  children?: ReactNode;
  hidden?: boolean;
  /** Quantos itens a seção representa (aparece ao lado do título). */
  count?: number;
}

export interface RecordAction {
  label: string;
  /** Abre a confirmação (com motivo) da gestão. */
  confirm: ActionSpec;
  danger?: boolean;
  hidden?: boolean;
}

function empty(v: ReactNode): boolean {
  return v === null || v === undefined || v === '' || v === false;
}

function FieldView({ field, editing, id }: { field: RecordField; editing: boolean; id: string }) {
  const editable = editing && field.input !== undefined;
  return (
    <div className={`record__field${field.wide ? ' record__field--wide' : ''}${editable ? ' record__field--edit' : ''}`}>
      <dt>{editable ? <label htmlFor={id}>{field.label}</label> : field.label}</dt>
      <dd>
        {editable ? (
          <>
            <span className="record__input">
              <FieldIdContext.Provider value={id}>{field.input}</FieldIdContext.Provider>
            </span>
            {field.problem ? (
              <span className="small alert" role="alert">
                {field.problem}
              </span>
            ) : field.hint ? (
              <span className="muted small">{field.hint}</span>
            ) : null}
          </>
        ) : empty(field.value) ? (
          <span className="muted">—</span>
        ) : (
          field.value
        )}
      </dd>
    </div>
  );
}

/**
 * Tela de detalhe de um registro (dentro do modal largo). No modo de ver mostra tudo; "Editar" troca os campos editáveis
 * por controles e pede o motivo; "Cancelar" volta sem salvar; "Salvar" manda só o que mudou.
 */
export function RecordView<D extends Record<string, unknown>>({ title, subtitle, status, media, links, sections, actions = [], editor, canEdit = true, editHint, onClose, onChanged, isNew = false }: {
  title: ReactNode;
  /** Cadastro de um registro novo: "Cancelar" fecha e o botão de salvar diz "Cadastrar". */
  isNew?: boolean;
  subtitle?: ReactNode;
  /** Situação e marcas (badges) ao lado do título. */
  status?: ReactNode;
  /** Capa, logo ou fotos no topo. */
  media?: ReactNode;
  /** Links para fora (abrir no app, mapa). */
  links?: ReactNode;
  sections: RecordSection[];
  actions?: RecordAction[];
  editor?: RecordEditor<D>;
  canEdit?: boolean;
  editHint?: string;
  onClose: () => void;
  /** Depois de uma ação confirmada (recarregar o registro). */
  onChanged?: () => void;
}) {
  const [confirm, setConfirm] = useState<ActionSpec>();
  const noteId = useId();
  const baseId = useId();
  const editing = editor?.editing === true;

  if (confirm) {
    return (
      <ActionDialog
        spec={confirm}
        onClose={() => setConfirm(undefined)}
        onDone={() => {
          onChanged?.();
        }}
      />
    );
  }

  const visibleActions = actions.filter((a) => !a.hidden);

  return (
    <div className="record">
      <header className="record__head">
        <div className="record__title">
          <h2>{title}</h2>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
          {status ? <div className="record__status">{status}</div> : null}
          {links && !editing ? <p className="record__links small">{links}</p> : null}
        </div>
        <div className="record__actions">
          {editing ? (
            <span className="badge badge--warn">Editando</span>
          ) : (
            <>
              {visibleActions.map((a) => (
                <button key={a.label} type="button" className={a.danger ? 'btn btn--small btn--danger-quiet' : 'btn btn--small'} onClick={() => setConfirm(a.confirm)}>
                  {a.label}
                </button>
              ))}
              {editor && canEdit ? (
                <button type="button" className="btn btn--small btn--primary" onClick={editor.start}>
                  Editar
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>
      {media && !editing ? <div className="record__media">{media}</div> : null}
      {editing && editHint ? <p className="muted small record__edithint">{editHint}</p> : null}
      {sections
        .filter((s) => !s.hidden)
        .map((s, si) => {
          const fields = (s.fields ?? []).filter((f) => !f.hidden);
          return (
            <section key={s.title} className="record__section">
              <h3>
                {s.title}
                {s.count !== undefined ? <span className="record__count">{s.count}</span> : null}
              </h3>
              {fields.length > 0 ? (
                <dl className="record__grid">
                  {fields.map((f, fi) => (
                    <FieldView key={f.label} field={f} editing={editing} id={`${baseId}-${si}-${fi}`} />
                  ))}
                </dl>
              ) : null}
              {s.children}
            </section>
          );
        })}
      {editing && editor && editor.noteRequired ? (
        <div className="field record__note">
          <label htmlFor={noteId}>Motivo (obrigatório)</label>
          <textarea id={noteId} rows={2} maxLength={300} value={editor.note} onChange={(e) => editor.setNote(e.target.value)} aria-invalid={editor.noteMissing ? true : undefined} />
          {editor.noteMissing ? (
            <span className="small alert" role="alert">
              Escreva o motivo para salvar.
            </span>
          ) : (
            <span className="muted small">{editor.note.length}/300 · fica registrado na auditoria com o que mudou</span>
          )}
        </div>
      ) : null}
      {editor?.error ? (
        <p className="notice notice--bad" role="alert">
          {editor.error}
        </p>
      ) : null}
      <div className="modal__actions record__foot">
        {editing && editor ? (
          <>
            <span className="muted small record__changed" aria-live="polite">
              {isNew ? '' : editor.changed.length === 0 ? 'Nada mudou ainda' : `${editor.changed.length} ${editor.changed.length === 1 ? 'campo alterado' : 'campos alterados'}`}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                editor.cancel();
                if (isNew) onClose();
              }}
              disabled={editor.busy}
            >
              Cancelar
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void editor.save()} disabled={editor.busy} aria-busy={editor.busy || undefined}>
              {editor.busy ? 'Salvando…' : isNew ? 'Cadastrar' : 'Salvar'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Fechar
          </button>
        )}
      </div>
    </div>
  );
}

/** O modal do detalhe com carregamento e erro: o mesmo para todos os registros. */
export function RecordModal<T>({ state, label, onClose, children }: { state: Async<T>; label: string; onClose: () => void; children: (data: T) => ReactNode }) {
  return (
    <Modal title={label} onClose={onClose} wide bare>
      {state.data === undefined ? (
        state.error ? (
          <div className="state" role="alert">
            <p>{state.error}</p>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={state.reload}>
                Tentar de novo
              </button>
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <div className="state muted">Carregando…</div>
        )
      ) : (
        <div className={state.loading ? 'is-loading' : undefined}>{children(state.data)}</div>
      )}
    </Modal>
  );
}

// ---------- Controles ligados ao rascunho ----------

type Keys<D, V> = { [K in keyof D]: D[K] extends V ? K : never }[keyof D];

export function TextInput<D extends Record<string, unknown>>({ editor, k, maxLength, placeholder, type = 'text' }: { editor: RecordEditor<D>; k: Keys<D, string>; maxLength?: number; placeholder?: string; type?: 'text' | 'url' | 'email' }) {
  return (
    <input
      id={useContext(FieldIdContext)}
      type={type}
      value={editor.draft[k] as string}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-invalid={editor.problems[k] ? true : undefined}
      onChange={(e) => editor.set(k, e.target.value as D[typeof k])}
    />
  );
}

export function TextArea<D extends Record<string, unknown>>({ editor, k, maxLength, rows = 3 }: { editor: RecordEditor<D>; k: Keys<D, string>; maxLength?: number; rows?: number }) {
  const value = editor.draft[k] as string;
  return (
    <>
      <textarea id={useContext(FieldIdContext)} rows={rows} value={value} maxLength={maxLength} aria-invalid={editor.problems[k] ? true : undefined} onChange={(e) => editor.set(k, e.target.value as D[typeof k])} />
      {maxLength ? <span className="muted small">{value.length}/{maxLength}</span> : null}
    </>
  );
}

export function NumberInput<D extends Record<string, unknown>>({ editor, k, step = 'any' }: { editor: RecordEditor<D>; k: Keys<D, string>; step?: string }) {
  return <input id={useContext(FieldIdContext)} type="number" step={step} inputMode="decimal" value={editor.draft[k] as string} aria-invalid={editor.problems[k] ? true : undefined} onChange={(e) => editor.set(k, e.target.value as D[typeof k])} />;
}

export function CheckInput<D extends Record<string, unknown>>({ editor, k, label }: { editor: RecordEditor<D>; k: Keys<D, boolean>; label: string }) {
  return (
    <label className="check">
      <input id={useContext(FieldIdContext)} type="checkbox" checked={editor.draft[k] as boolean} onChange={(e) => editor.set(k, e.target.checked as D[typeof k])} /> {label}
    </label>
  );
}

export function SelectInput<D extends Record<string, unknown>>({ editor, k, options }: { editor: RecordEditor<D>; k: Keys<D, string>; options: { value: string; label: string }[] }) {
  return (
    <select id={useContext(FieldIdContext)} className="select" value={editor.draft[k] as string} onChange={(e) => editor.set(k, e.target.value as D[typeof k])}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateTimeInput<D extends Record<string, unknown>>({ editor, k }: { editor: RecordEditor<D>; k: Keys<D, string> }) {
  return <input id={useContext(FieldIdContext)} type="datetime-local" value={editor.draft[k] as string} aria-invalid={editor.problems[k] ? true : undefined} onChange={(e) => editor.set(k, e.target.value as D[typeof k])} />;
}

export function DateInput<D extends Record<string, unknown>>({ editor, k, max }: { editor: RecordEditor<D>; k: Keys<D, string>; max?: string }) {
  return <input id={useContext(FieldIdContext)} type="date" value={editor.draft[k] as string} max={max} aria-invalid={editor.problems[k] ? true : undefined} onChange={(e) => editor.set(k, e.target.value as D[typeof k])} />;
}

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> → ISO (vazio fica vazio). */
export function fromLocalInput(value: string): string {
  if (value === '') return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

// ---------- Valores comuns ----------

export function YesNo({ value }: { value: boolean | null | undefined }) {
  return <>{value === true ? 'Sim' : value === false ? 'Não' : '—'}</>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono small">{children}</span>;
}

/** Lista curta ligada ao registro (amigos, eventos...): cada item com o principal, o detalhe e a data. */
export function LinkedList<T>({ items, total, empty, render, keyOf }: { items: T[]; total?: number; empty: string; keyOf: (item: T) => string; render: (item: T) => { main: ReactNode; side?: ReactNode; past?: boolean } }) {
  if (items.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <>
      <ul className="record__list">
        {items.map((item) => {
          const r = render(item);
          return (
            <li key={keyOf(item)} className={r.past ? 'is-past' : undefined}>
              <span className="record__listmain">{r.main}</span>
              {r.side ? <span className="muted small record__listside">{r.side}</span> : null}
            </li>
          );
        })}
      </ul>
      {total !== undefined && total > items.length ? <p className="muted small">Mostrando {items.length} de {total}.</p> : null}
    </>
  );
}

// ---------- Abrir qualquer registro ----------

export type RecordKind = 'user' | 'venue' | 'event' | 'post';
export interface RecordRef {
  kind: RecordKind;
  id: string;
}

type Renderers = Record<RecordKind, (id: string, close: () => void) => ReactNode>;

const OpenContext = createContext<(ref: RecordRef) => void>(() => undefined);

/** Abre o detalhe de qualquer registro por cima da tela; fechar volta para o que estava aberto antes. */
export function RecordsProvider({ renderers, children }: { renderers: Renderers; children: ReactNode }) {
  const [stack, setStack] = useState<RecordRef[]>([]);
  const open = useCallback((ref: RecordRef) => setStack((s) => [...s, ref]), []);
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const top = stack[stack.length - 1];
  return (
    <OpenContext.Provider value={open}>
      {children}
      {top ? <div key={`${stack.length}-${top.kind}-${top.id}`}>{renderers[top.kind](top.id, close)}</div> : null}
    </OpenContext.Provider>
  );
}

export function useOpenRecord(): (ref: RecordRef) => void {
  return useContext(OpenContext);
}

/** Link para o detalhe de outro registro (abre por cima, sem sair da tela). */
export function RecordLink({ kind, id, children, label }: { kind: RecordKind; id: string; children: ReactNode; label?: string }) {
  const open = useOpenRecord();
  return (
    <button type="button" className="linkbtn" onClick={() => open({ kind, id })} aria-label={label}>
      {children}
    </button>
  );
}

/** Link para a pessoa: @usuário que abre o detalhe dela. Com `avatarUrl` (mesmo nulo), mostra a foto (ou a inicial) ao lado. */
export function PersonLink({ id, username, displayName, avatarUrl }: { id: string; username: string; displayName?: string; avatarUrl?: string | null }) {
  const withPhoto = avatarUrl !== undefined;
  return (
    <RecordLink kind="user" id={id} label={`Abrir @${username}`}>
      {withPhoto ? (
        avatarUrl ? (
          <img className="personlink__avatar" src={avatarSrc(avatarUrl)} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="personlink__avatar personlink__avatar--empty" aria-hidden="true">
            {(displayName || username).trim().charAt(0).toUpperCase()}
          </span>
        )
      ) : null}
      {displayName ? <strong>{displayName}</strong> : null} <span className="handle">@{username}</span>
    </RecordLink>
  );
}

/** Recarrega a lista da tela quando algo foi decidido ou salvo em qualquer detalhe. */
export function useReloadOnChange(reload: () => void): void {
  useEffect(() => {
    window.addEventListener(CHANGED_EVENT, reload);
    return () => window.removeEventListener(CHANGED_EVENT, reload);
  }, [reload]);
}
