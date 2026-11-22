import { useEffect, useId, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { formatDateTime } from '../labels.ts';
import type { UserActivityItem, UserRow } from '../types.ts';
import { Modal } from '../ui.tsx';

/** Corrige nome, @usuário e biografia. Motivo obrigatório: o que mudou fica na auditoria. */
export function EditUserDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ids = { name: useId(), user: useId(), bio: useId(), note: useId() };

  // A biografia não vem na lista: busca a pessoa para o formulário começar preenchido.
  useEffect(() => {
    let alive = true;
    api
      .userDetail(user.id)
      .then((d) => {
        if (alive) setBio(d.bio ?? '');
      })
      .catch(() => {
        if (alive) setBio('');
      });
    return () => {
      alive = false;
    };
  }, [user.id]);

  async function save() {
    if (busy || note.trim() === '') return;
    setBusy(true);
    setError(undefined);
    try {
      await api.editUser(user.id, {
        ...(displayName !== user.displayName ? { displayName } : {}),
        ...(username !== user.username ? { username } : {}),
        ...(bio !== undefined ? { bio: bio.trim() === '' ? null : bio } : {}),
        note: note.trim(),
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Editar @${user.username}`} onClose={onClose}>
      <div className="modal__body">
        <p>Use para corrigir um nome ou @ ofensivo, de outra marca, ou a pedido da pessoa. O que mudou fica na auditoria.</p>
      </div>
      <div className="field">
        <label htmlFor={ids.name}>Nome</label>
        <input id={ids.name} value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.user}>@usuário</label>
        <input id={ids.user} value={username} maxLength={30} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor={ids.bio}>Biografia</label>
        <textarea id={ids.bio} rows={3} maxLength={160} value={bio ?? ''} disabled={bio === undefined} onChange={(e) => setBio(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={ids.note}>Motivo</label>
        <textarea id={ids.note} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className="muted small">{note.length}/300 · fica registrado na auditoria</span>
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
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || note.trim() === '' || bio === undefined} aria-busy={busy || undefined}>
          {busy ? 'Aguarde…' : 'Salvar'}
        </button>
      </div>
    </Modal>
  );
}

const KINDS: { id: string; label: string }[] = [
  { id: '', label: 'Tudo' },
  { id: 'POST', label: 'Posts' },
  { id: 'COMMENT', label: 'Comentários' },
  { id: 'LIKE', label: 'Curtidas' },
  { id: 'EVENT', label: 'Eventos' },
  { id: 'FOLLOW', label: 'Seguiu' },
];

const ACTION_TEXT: Record<string, string> = {
  POST_LIKE: 'Curtiu um post',
  FEED_REACTION: 'Reagiu a uma publicação',
  POST_COMMENT: 'Comentou num post',
  FEED_COMMENT: 'Comentou numa publicação',
  POST_CREATED: 'Publicou um post',
  EVENT_CREATED: 'Criou um evento',
  FEED_POST: 'Publicou no feed de um evento ou local',
  EVENT_GOING: 'Confirmou presença',
  FOLLOW_USER: 'Seguiu',
  FOLLOW_VENUE: 'Seguiu o local',
};

function describe(item: UserActivityItem): string {
  const base = ACTION_TEXT[item.action] ?? item.action;
  const who = item.person ? ` @${item.person.username}` : '';
  const what = item.title ? ` · ${item.title}` : '';
  return `${base}${item.action === 'FOLLOW_USER' || item.action.endsWith('LIKE') || item.action.endsWith('COMMENT') ? who : ''}${what}${item.pending ? ' (pedido pendente)' : ''}`;
}

/** O que a pessoa fez no app (o mesmo registro que ela vê em Atividade), do mais recente ao mais antigo. */
export function UserActivityDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<UserActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  async function load(nextKind: string, after: string | null) {
    setLoading(true);
    setError(undefined);
    try {
      const page = await api.userActivity(user.id, { kind: nextKind, cursor: after });
      setItems((current) => (after ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(kind, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, user.id]);

  return (
    <Modal title={`Atividade de @${user.username}`} onClose={onClose} wide>
      <div className="row-actions">
        <select className="select" aria-label="Tipo de atividade" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && items.length === 0 && !error ? <p className="muted">Nenhuma atividade.</p> : null}
      {items.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>O quê</th>
              <th>Texto</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.at)}</td>
                <td>
                  {describe(item)}
                  {item.available ? null : <span className="muted small"> (não está mais disponível)</span>}
                </td>
                <td>{item.text ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="modal__actions">
        {cursor ? (
          <button type="button" className="btn" onClick={() => void load(kind, cursor)} disabled={loading}>
            {loading ? 'Carregando…' : 'Carregar mais'}
          </button>
        ) : null}
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
