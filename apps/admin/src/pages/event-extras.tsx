import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { useAsync } from '../hooks.ts';
import type { EventExtra, EventExtraInput } from '../types.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, RecordCount } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';
// Os desenhos são os mesmos do app (um arquivo só, para os dois mostrarem igual).
import { EVENT_EXTRA_ICON_LABELS, eventExtraIconPaths } from '../../../web/src/lib/event-extra-icons.ts';

const LABEL_MAX = 60;
const TYPE_LABEL: Record<EventExtra['type'], string> = { YES_NO: 'Sim ou não', TEXT: 'Texto livre' };

export function ExtraIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {eventExtraIconPaths(icon).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function ExtraForm({ icons, initial, onClose, onSaved }: { icons: string[]; initial: EventExtra | null; onClose: () => void; onSaved: () => void }) {
  const [icon, setIcon] = useState(initial?.icon ?? icons[0] ?? 'info');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [type, setType] = useState<EventExtra['type']>(initial?.type ?? 'YES_NO');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = label.trim() !== '' && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    const input: EventExtraInput = { icon, label: label.trim(), type };
    try {
      if (initial) await api.updateEventExtra(initial.id, input);
      else await api.createEventExtra(input);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? 'Editar configuração' : 'Nova configuração de evento'} onClose={onClose} wide>
      <div className="field">
        <label htmlFor="extra-label">Nome</label>
        <input id="extra-label" value={label} maxLength={LABEL_MAX} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Pode fumar?" autoFocus />
        <span className="muted small">{label.trim().length}/{LABEL_MAX}</span>
      </div>
      <fieldset className="field extras__fieldset">
        <legend>Tipo de resposta</legend>
        <label className="check">
          <input type="radio" name="extra-type" checked={type === 'YES_NO'} onChange={() => setType('YES_NO')} /> Sim ou não <span className="muted small">(ex.: Pode fumar?)</span>
        </label>
        <label className="check">
          <input type="radio" name="extra-type" checked={type === 'TEXT'} onChange={() => setType('TEXT')} /> Texto livre <span className="muted small">(ex.: Estacionamento: “na rua de trás”)</span>
        </label>
      </fieldset>
      <fieldset className="field extras__fieldset">
        <legend>Ícone</legend>
        <div className="extras__icons" role="radiogroup" aria-label="Ícone">
          {icons.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={icon === key}
              className={`extras__iconbtn${icon === key ? ' extras__iconbtn--on' : ''}`}
              onClick={() => setIcon(key)}
              title={EVENT_EXTRA_ICON_LABELS[key] ?? key}
              aria-label={EVENT_EXTRA_ICON_LABELS[key] ?? key}
            >
              <ExtraIcon icon={key} />
            </button>
          ))}
        </div>
      </fieldset>
      <div className="extras__preview" aria-label="Como aparece na página do evento">
        <span className="muted small">Na página do evento:</span>
        <span className="extras__previewrow">
          <ExtraIcon icon={icon} size={20} />
          <span>{label.trim() || 'Nome da configuração'}</span>
          <strong>{type === 'YES_NO' ? 'Sim' : 'na rua de trás'}</strong>
        </span>
      </div>
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

export function EventExtrasPage() {
  const state = useAsync(() => api.eventExtras(), []);
  const [editing, setEditing] = useState<EventExtra | null | undefined>();
  const [action, setAction] = useState<ActionSpec>();
  const [moving, setMoving] = useState<string>();
  const [error, setError] = useState<string>();

  async function move(id: string, direction: 'up' | 'down') {
    setMoving(id);
    setError(undefined);
    try {
      await api.moveEventExtra(id, direction);
      state.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setMoving(undefined);
    }
  }

  function remove(extra: EventExtra) {
    setAction({
      title: `Apagar “${extra.label}”`,
      description: <p>Some da criação de eventos e da página dos eventos que já responderam. Não dá para desfazer.</p>,
      confirmLabel: 'Apagar',
      danger: true,
      run: () => api.deleteEventExtra(extra.id),
    });
  }

  return (
    <>
      <PageHead title="Configurações de evento" hint="Perguntas que quem cria um evento pode responder, como “Pode fumar?” ou “Estacionamento”. Aparecem recolhidas na criação e, respondidas, na página do evento.">
        <button type="button" className="btn btn--primary" onClick={() => setEditing(null)} disabled={!state.data}>
          Nova configuração
        </button>
      </PageHead>
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      <Loadable state={state} empty="Nenhuma configuração cadastrada ainda. Clique em “Nova configuração”." isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Ordem</th>
                <th scope="col">Ícone</th>
                <th scope="col">Nome</th>
                <th scope="col">Resposta</th>
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
                    <span className="extras__cellicon" title={EVENT_EXTRA_ICON_LABELS[x.icon] ?? x.icon}>
                      <ExtraIcon icon={x.icon} />
                    </span>
                  </td>
                  <td>
                    <strong>{x.label}</strong>
                  </td>
                  <td>
                    <Badge tone={x.type === 'YES_NO' ? 'info' : 'neutral'}>{TYPE_LABEL[x.type]}</Badge>
                  </td>
                  <td className="nowrap" style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn--small" onClick={() => setEditing(x)}>
                      Editar
                    </button>{' '}
                    <button type="button" className="btn btn--small btn--danger-quiet" onClick={() => remove(x)}>
                      Apagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loadable>
      {state.data ? <RecordCount count={state.data.items.length} /> : null}
      <p className="muted small">Renomear ou trocar o ícone vale também para os eventos já criados. Cada mudança fica na Auditoria.</p>
      {editing !== undefined && state.data ? <ExtraForm icons={state.data.icons} initial={editing} onClose={() => setEditing(undefined)} onSaved={state.reload} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={state.reload} /> : null}
    </>
  );
}
