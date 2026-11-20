import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { useAsync } from '../hooks.ts';
import type { Taste, TasteInput } from '../types.ts';
import { ActionDialog, Loadable, Modal, PageHead } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';
// Os desenhos são os mesmos do app (um arquivo só, para os dois mostrarem igual).
import { TASTE_ICON_LABELS, TASTE_ICON_PATHS, tasteIconPaths } from '../../../web/src/lib/taste-icons.ts';

const LABEL_MAX = 40;
const HINT_MAX = 90;
const KIND_LABELS: Record<string, string> = {
  SHOW: 'Show',
  NIGHT: 'Noite / balada',
  GASTRONOMY: 'Gastronomia',
  CINEMA: 'Cinema',
  THEATER: 'Teatro',
  EXHIBITION: 'Exposição',
  OUTDOOR: 'Ao ar livre',
  SPORT: 'Esporte',
  DIGITAL: 'Online',
  OTHER: 'Outro',
};
const KINDS = Object.keys(KIND_LABELS);
const ICONS = Object.keys(TASTE_ICON_PATHS);

function TasteIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {tasteIconPaths(icon).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function TasteForm({ initial, onClose, onSaved }: { initial: Taste | null; onClose: () => void; onSaved: () => void }) {
  const [icon, setIcon] = useState(initial?.icon ?? ICONS[0] ?? 'star');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [hint, setHint] = useState(initial?.hint ?? '');
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join('\n'));
  const [kinds, setKinds] = useState<Set<string>>(new Set(initial?.kinds ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = label.trim() !== '' && hint.trim() !== '' && keywords.trim() !== '' && !busy;

  function toggleKind(kind: string) {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    const input: TasteInput = { icon, label: label.trim(), hint: hint.trim(), keywords, kinds: KINDS.filter((k) => kinds.has(k)) };
    try {
      if (initial) await api.updateTaste(initial.id, input);
      else await api.createTaste(input);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? 'Editar gosto' : 'Novo gosto'} onClose={onClose} wide>
      <div className="field">
        <label htmlFor="taste-label">Nome</label>
        <input id="taste-label" value={label} maxLength={LABEL_MAX} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Bares" autoFocus />
        <span className="muted small">{label.trim().length}/{LABEL_MAX}</span>
      </div>
      <div className="field">
        <label htmlFor="taste-hint">Descrição</label>
        <input id="taste-hint" value={hint} maxLength={HINT_MAX} onChange={(e) => setHint(e.target.value)} placeholder="Ex.: Boteco, pub, música ao vivo, happy hour" />
        <span className="muted small">Aparece abaixo do nome, na escolha de gostos. {hint.trim().length}/{HINT_MAX}</span>
      </div>
      <div className="field">
        <label htmlFor="taste-keywords">Palavras do tipo do local</label>
        <textarea id="taste-keywords" rows={6} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={'bar\npub\nboteco\ncervejaria*'} />
        <span className="muted small">
          Uma por linha (ou separadas por vírgula). Sem acento e sem diferença de maiúscula. “bar” casa só a palavra inteira; com asterisco, “restaura*”, casa tudo que começa assim (restaurante, restaurant). Vale para o tipo do local, escrito pelo dono ou vindo do Google.
        </span>
      </div>
      <fieldset className="field extras__fieldset">
        <legend>Ícone</legend>
        <div className="extras__icons" role="radiogroup" aria-label="Ícone">
          {ICONS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={icon === key}
              className={`extras__iconbtn${icon === key ? ' extras__iconbtn--on' : ''}`}
              onClick={() => setIcon(key)}
              title={TASTE_ICON_LABELS[key] ?? key}
              aria-label={TASTE_ICON_LABELS[key] ?? key}
            >
              <TasteIcon icon={key} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field extras__fieldset">
        <legend>Tipos de evento deste gosto (opcional)</legend>
        {KINDS.map((kind) => (
          <label key={kind} className="check">
            <input type="checkbox" checked={kinds.has(kind)} onChange={() => toggleKind(kind)} /> {KIND_LABELS[kind]}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!ready || busy} aria-busy={busy || undefined}>
          {busy ? 'Aguarde…' : initial ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </Modal>
  );
}

export function TastesPage() {
  const state = useAsync(() => api.tastes(), []);
  const [editing, setEditing] = useState<Taste | null | undefined>();
  const [action, setAction] = useState<ActionSpec>();
  const [moving, setMoving] = useState<string>();
  const [error, setError] = useState<string>();

  async function move(id: string, direction: 'up' | 'down') {
    setMoving(id);
    setError(undefined);
    try {
      await api.moveTaste(id, direction);
      state.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setMoving(undefined);
    }
  }

  function remove(taste: Taste) {
    setAction({
      title: `Apagar “${taste.label}”`,
      description: <p>Some das escolhas do cadastro e do filtro do Explorar. Quem já tinha marcado esse gosto deixa de tê-lo. Não dá para desfazer.</p>,
      confirmLabel: 'Apagar',
      danger: true,
      run: () => api.deleteTaste(taste.id),
    });
  }

  return (
    <>
      <PageHead title="Gostos de rolê" hint="Os gostos que a pessoa escolhe ao se cadastrar e nas configurações, e que filtram locais e eventos no Explorar. A ordem daqui é a das telas.">
        <button type="button" className="btn btn--primary" onClick={() => setEditing(null)} disabled={!state.data}>
          Novo gosto
        </button>
      </PageHead>
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      <Loadable state={state} empty="Nenhum gosto cadastrado." isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Ordem</th>
                <th scope="col">Ícone</th>
                <th scope="col">Nome</th>
                <th scope="col">Palavras do tipo do local</th>
                <th scope="col">Tipos de evento</th>
                <th scope="col">
                  <span className="visually-hidden">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((x, i) => (
                <tr key={x.id}>
                  <td className="nowrap">
                    <button type="button" className="btn btn--small" aria-label={`Subir ${x.label}`} disabled={i === 0 || moving !== undefined} onClick={() => void move(x.id, 'up')}>
                      ↑
                    </button>{' '}
                    <button type="button" className="btn btn--small" aria-label={`Descer ${x.label}`} disabled={i === d.items.length - 1 || moving !== undefined} onClick={() => void move(x.id, 'down')}>
                      ↓
                    </button>
                  </td>
                  <td>
                    <span className="extras__cellicon" title={TASTE_ICON_LABELS[x.icon] ?? x.icon}>
                      <TasteIcon icon={x.icon} />
                    </span>
                  </td>
                  <td>
                    <strong>{x.label}</strong>
                    <div className="muted small">{x.hint}</div>
                  </td>
                  <td className="small">{x.keywords.join(', ')}</td>
                  <td className="small">{x.kinds.length === 0 ? <span className="muted">—</span> : x.kinds.map((k) => KIND_LABELS[k] ?? k).join(', ')}</td>
                  <td className="nowrap" style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn--small" onClick={() => setEditing(x)}>
                      Editar
                    </button>{' '}
                    <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => remove(x)} disabled={d.items.length === 1}>
                      Apagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
      <p className="muted small">Mudanças valem na hora no app. Cada alteração fica na Auditoria.</p>
      {editing !== undefined && state.data ? <TasteForm initial={editing} onClose={() => setEditing(undefined)} onSaved={state.reload} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={state.reload} /> : null}
    </>
  );
}
