import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from './api.ts';
import type { Async } from './hooks.ts';

export function PageHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <header className="pagehead">
      <div>
        <h1>{title}</h1>
        {hint ? <p className="muted">{hint}</p> : null}
      </div>
      {children ? <div className="pagehead__actions">{children}</div> : null}
    </header>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <input className="search" type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} />
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'tab tab--on' : 'tab'} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && o.count > 0 ? <span className="tab__count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pager({ offset, limit, hasMore, onChange }: { offset: number; limit: number; hasMore: boolean; onChange: (offset: number) => void }) {
  if (offset === 0 && !hasMore) return null;
  return (
    <div className="pager">
      <button type="button" className="btn" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Anteriores
      </button>
      <span className="muted">
        {offset + 1}–{offset + limit}
      </span>
      <button type="button" className="btn" disabled={!hasMore} onClick={() => onChange(offset + limit)}>
        Próximos
      </button>
    </div>
  );
}

/** Estado de uma lista: carregando, erro (com tentar de novo) ou vazio. Mostra os filhos quando há dados. */
export function Loadable<T>({ state, empty, isEmpty, children }: { state: Async<T>; empty: string; isEmpty: (data: T) => boolean; children: (data: T) => ReactNode }) {
  if (state.data === undefined) {
    if (state.error) {
      return (
        <div className="state" role="alert">
          <p>{state.error}</p>
          <button type="button" className="btn" onClick={state.reload}>
            Tentar de novo
          </button>
        </div>
      );
    }
    return <div className="state muted">Carregando…</div>;
  }
  return (
    <div className={state.loading ? 'is-loading' : undefined}>
      {state.error ? (
        <p className="notice notice--bad" role="alert">
          {state.error}
        </p>
      ) : null}
      {isEmpty(state.data) ? <div className="state muted">{empty}</div> : children(state.data)}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal modal--wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ActionSpec {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  noteLabel?: string;
  noteRequired?: boolean;
  run: (note: string) => Promise<unknown>;
}

/** Confirma uma ação da gestão, com motivo opcional ou obrigatório. Os motivos ficam na auditoria. */
export function ActionDialog({ spec, onClose, onDone }: { spec: ActionSpec; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const noteId = useId();
  const missing = spec.noteRequired === true && note.trim() === '';

  async function confirm() {
    if (missing || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await spec.run(note.trim());
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <Modal title={spec.title} onClose={onClose}>
      {spec.description ? <div className="modal__body">{spec.description}</div> : null}
      {spec.noteLabel ? (
        <div className="field">
          <label htmlFor={noteId}>
            {spec.noteLabel}
            {spec.noteRequired ? '' : ' (opcional)'}
          </label>
          <textarea id={noteId} rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <span className="muted small">{note.length}/300 · fica registrado na auditoria</span>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className={spec.danger ? 'btn btn--danger' : 'btn btn--primary'} onClick={confirm} disabled={missing || busy}>
          {busy ? 'Aguarde…' : spec.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function UserLink({ username }: { username: string }) {
  return <span className="handle">@{username}</span>;
}
