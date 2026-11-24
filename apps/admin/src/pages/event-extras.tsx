import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { useAsync } from '../hooks.ts';
import type { EventExtra, EventExtraInput } from '../types.ts';
import { ActionDialog, Badge, Loadable, Modal, PageHead, RecordCount } from '../ui.tsx';
import { Mono, RecordView, TextInput, useRecordEditor } from '../record.tsx';
import type { RecordSection } from '../record.tsx';
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

type ExtraDraft = { label: string; type: EventExtra['type']; icon: string };

/** Uma configuração de evento no padrão de detalhe: ver, editar (ou cadastrar uma nova) com o mesmo salvar e cancelar. */
function ExtraForm({ icons, initial, onClose, onSaved }: { icons: string[]; initial: EventExtra | null; onClose: () => void; onSaved: () => void }) {
  const editor = useRecordEditor<ExtraDraft>({
    initial: { label: initial?.label ?? '', type: initial?.type ?? 'YES_NO', icon: initial?.icon ?? icons[0] ?? 'info' },
    noteRequired: false,
    startEditing: initial === null,
    check: (d) => (d.label.trim() === '' ? { label: 'Informe o nome' } : {}),
    save: async (_changes, _note, d) => {
      const input: EventExtraInput = { icon: d.icon, label: d.label.trim(), type: d.type };
      if (initial) await api.updateEventExtra(initial.id, input);
      else await api.createEventExtra(input);
    },
    onSaved: () => {
      onSaved();
      if (!initial) onClose();
    },
  });
  const d = editor.draft;
  const sections: RecordSection[] = [
    {
      title: 'Configuração',
      fields: [
        { label: 'Nome', value: <strong>{initial?.label}</strong>, input: <TextInput editor={editor} k="label" maxLength={LABEL_MAX} placeholder="Ex.: Pode fumar?" />, problem: editor.problems.label, hint: `${d.label.trim().length}/${LABEL_MAX}` },
        {
          label: 'Tipo de resposta',
          value: initial ? TYPE_LABEL[initial.type] : null,
          input: (
            <span className="record__checks">
              <label className="check">
                <input type="radio" name="extra-type" checked={d.type === 'YES_NO'} onChange={() => editor.set('type', 'YES_NO')} /> Sim ou não <span className="muted small">(ex.: Pode fumar?)</span>
              </label>
              <label className="check">
                <input type="radio" name="extra-type" checked={d.type === 'TEXT'} onChange={() => editor.set('type', 'TEXT')} /> Texto livre <span className="muted small">(ex.: Estacionamento: “na rua de trás”)</span>
              </label>
            </span>
          ),
        },
        {
          label: 'Ícone',
          value: initial ? (
            <span className="extras__cellicon">
              <ExtraIcon icon={initial.icon} /> {EVENT_EXTRA_ICON_LABELS[initial.icon] ?? initial.icon}
            </span>
          ) : null,
          input: (
            <div className="extras__icons" role="radiogroup" aria-label="Ícone">
              {icons.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={d.icon === key} className={`extras__iconbtn${d.icon === key ? ' extras__iconbtn--on' : ''}`} onClick={() => editor.set('icon', key)} title={EVENT_EXTRA_ICON_LABELS[key] ?? key} aria-label={EVENT_EXTRA_ICON_LABELS[key] ?? key}>
                  <ExtraIcon icon={key} />
                </button>
              ))}
            </div>
          ),
          wide: true,
        },
        {
          label: 'Na página do evento',
          value: null,
          input: (
            <span className="extras__previewrow">
              <ExtraIcon icon={d.icon} size={20} />
              <span>{d.label.trim() || 'Nome da configuração'}</span>
              <strong>{d.type === 'YES_NO' ? 'Sim' : 'na rua de trás'}</strong>
            </span>
          ),
          wide: true,
          hidden: !editor.editing,
        },
        { label: 'ID', value: initial ? <Mono>{initial.id}</Mono> : null, hidden: !initial },
      ],
    },
  ];
  return (
    <Modal title={initial ? initial.label : 'Nova configuração de evento'} onClose={onClose} wide bare>
      <RecordView title={initial ? initial.label : 'Nova configuração de evento'} subtitle="Configuração de evento" sections={sections} editor={editor} isNew={!initial} onClose={onClose} />
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
                      Detalhes
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
