import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { useAsync } from '../hooks.ts';
import type { Taste, TasteInput } from '../types.ts';
import { ActionDialog, Loadable, Modal, PageHead, RecordCount } from '../ui.tsx';
import { Mono, RecordView, TextArea, TextInput, useRecordEditor } from '../record.tsx';
import type { RecordSection } from '../record.tsx';
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

type TasteDraft = { label: string; hint: string; keywords: string; icon: string; kinds: string[] };

/** Um gosto de rolê no padrão de detalhe: ver, editar (ou cadastrar um novo) com o mesmo salvar e cancelar das outras telas. */
function TasteForm({ initial, onClose, onSaved }: { initial: Taste | null; onClose: () => void; onSaved: () => void }) {
  const editor = useRecordEditor<TasteDraft>({
    initial: { label: initial?.label ?? '', hint: initial?.hint ?? '', keywords: (initial?.keywords ?? []).join('\n'), icon: initial?.icon ?? ICONS[0] ?? 'star', kinds: initial?.kinds ?? [] },
    noteRequired: false,
    startEditing: initial === null,
    check: (d) => ({
      ...(d.label.trim() === '' ? { label: 'Informe o nome' } : {}),
      ...(d.hint.trim() === '' ? { hint: 'Informe a descrição' } : {}),
      ...(d.keywords.trim() === '' ? { keywords: 'Informe ao menos uma palavra' } : {}),
    }),
    save: async (_changes, _note, d) => {
      const input: TasteInput = { icon: d.icon, label: d.label.trim(), hint: d.hint.trim(), keywords: d.keywords, kinds: KINDS.filter((k) => d.kinds.includes(k)) };
      if (initial) await api.updateTaste(initial.id, input);
      else await api.createTaste(input);
    },
    onSaved: () => {
      onSaved();
      if (!initial) onClose();
    },
  });
  const d = editor.draft;
  const p = editor.problems;
  const toggleKind = (kind: string) => editor.set('kinds', d.kinds.includes(kind) ? d.kinds.filter((k) => k !== kind) : [...d.kinds, kind]);
  const sections: RecordSection[] = [
    {
      title: 'Gosto',
      fields: [
        { label: 'Nome', value: <strong>{initial?.label}</strong>, input: <TextInput editor={editor} k="label" maxLength={LABEL_MAX} placeholder="Ex.: Bares" />, problem: p.label, hint: `${d.label.trim().length}/${LABEL_MAX}` },
        { label: 'Descrição', value: initial?.hint, input: <TextInput editor={editor} k="hint" maxLength={HINT_MAX} placeholder="Ex.: Boteco, pub, música ao vivo, happy hour" />, problem: p.hint, hint: `Aparece abaixo do nome, na escolha de gostos. ${d.hint.trim().length}/${HINT_MAX}`, wide: true },
        {
          label: 'Palavras do tipo do local',
          value: initial && initial.keywords.length > 0 ? initial.keywords.join(', ') : null,
          input: <TextArea editor={editor} k="keywords" rows={6} />,
          problem: p.keywords,
          hint: 'Uma por linha (ou separadas por vírgula). Sem acento e sem diferença de maiúscula. “bar” casa só a palavra inteira; com asterisco, “restaura*”, casa tudo que começa assim (restaurante, restaurant). Vale para o tipo do local, escrito pelo dono ou vindo do Google.',
          wide: true,
        },
        {
          label: 'Ícone',
          value: initial ? (
            <span className="extras__cellicon" title={TASTE_ICON_LABELS[initial.icon] ?? initial.icon}>
              <TasteIcon icon={initial.icon} /> {TASTE_ICON_LABELS[initial.icon] ?? initial.icon}
            </span>
          ) : null,
          input: (
            <div className="extras__icons" role="radiogroup" aria-label="Ícone">
              {ICONS.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={d.icon === key} className={`extras__iconbtn${d.icon === key ? ' extras__iconbtn--on' : ''}`} onClick={() => editor.set('icon', key)} title={TASTE_ICON_LABELS[key] ?? key} aria-label={TASTE_ICON_LABELS[key] ?? key}>
                  <TasteIcon icon={key} />
                </button>
              ))}
            </div>
          ),
          wide: true,
        },
        {
          label: 'Tipos de evento deste gosto',
          value: initial && initial.kinds.length > 0 ? initial.kinds.map((k) => KIND_LABELS[k] ?? k).join(', ') : null,
          input: (
            <span className="record__checks">
              {KINDS.map((kind) => (
                <label key={kind} className="check">
                  <input type="checkbox" checked={d.kinds.includes(kind)} onChange={() => toggleKind(kind)} /> {KIND_LABELS[kind]}
                </label>
              ))}
            </span>
          ),
          hint: 'Opcional.',
          wide: true,
        },
        { label: 'ID', value: initial ? <Mono>{initial.id}</Mono> : null, hidden: !initial },
      ],
    },
  ];
  return (
    <Modal title={initial ? initial.label : 'Novo gosto'} onClose={onClose} wide bare>
      <RecordView title={initial ? initial.label : 'Novo gosto'} subtitle="Gosto de rolê" sections={sections} editor={editor} isNew={!initial} onClose={onClose} />
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
                    <button type="button" className="linkbtn" onClick={() => setEditing(x)}>
                      <strong>{x.label}</strong>
                    </button>
                    <div className="muted small">{x.hint}</div>
                  </td>
                  <td className="small">{x.keywords.join(', ')}</td>
                  <td className="small">{x.kinds.length === 0 ? <span className="muted">—</span> : x.kinds.map((k) => KIND_LABELS[k] ?? k).join(', ')}</td>
                  <td className="nowrap" style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn--small" onClick={() => setEditing(x)}>
                      Detalhes
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
      {state.data ? <RecordCount count={state.data.items.length} /> : null}
      <p className="muted small">Mudanças valem na hora no app. Cada alteração fica na Auditoria.</p>
      {editing !== undefined && state.data ? <TasteForm initial={editing} onClose={() => setEditing(undefined)} onSaved={state.reload} /> : null}
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={state.reload} /> : null}
    </>
  );
}
