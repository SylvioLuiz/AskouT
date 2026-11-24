import { useEffect, useId, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { useDebounced } from '../hooks.ts';
import { STATUS_LABEL, formatBirthDate, formatDate, formatDateTime } from '../labels.ts';
import type { UserActivityItem, UserRow } from '../types.ts';
import { Badge, Modal } from '../ui.tsx';

const ROLE_LABEL: Record<UserRow['role'], string> = { USER: 'Pessoa', VENUE_OWNER: 'Responsável por local', ADMIN: 'Admin' };

/**
 * Detalhes de uma pessoa. "Editar" deixa nome, @usuário e biografia editáveis.
 * Motivo obrigatório ao salvar: o que mudou fica na auditoria.
 */
export function UserDetailDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  // O que está salvo agora (começa pela linha da tabela e se atualiza depois de salvar).
  const [saved, setSaved] = useState({ displayName: user.displayName, username: user.username });
  const [savedBio, setSavedBio] = useState<string | undefined>();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [noteMissing, setNoteMissing] = useState(false);
  // O @ novo é conferido enquanto se digita: livre, já em uso ou fora do formato.
  const [check, setCheck] = useState<{ username: string; available: boolean; problem?: string } | undefined>();
  const typed = useDebounced(username.trim());
  const ids = { name: useId(), user: useId(), bio: useId(), note: useId() };
  const canEdit = user.role !== 'ADMIN';

  // A biografia não vem na lista: busca a pessoa.
  useEffect(() => {
    let alive = true;
    api
      .userDetail(user.id)
      .then((d) => {
        if (alive) setSavedBio(d.bio ?? '');
      })
      .catch(() => {
        if (alive) setSavedBio('');
      });
    return () => {
      alive = false;
    };
  }, [user.id]);

  useEffect(() => {
    setCheck(undefined);
    if (!editing || typed === '' || typed.toLowerCase() === saved.username) return;
    let alive = true;
    api
      .usernameAvailableFor(user.id, typed)
      .then((r) => {
        if (alive) setCheck(r);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [editing, typed, user.id, saved.username]);

  function startEdit() {
    setDisplayName(saved.displayName);
    setUsername(saved.username);
    setBio(savedBio ?? '');
    setNote('');
    setNoteMissing(false);
    setError(undefined);
    setEditing(true);
  }

  const usernameChanged = username.trim().toLowerCase() !== saved.username;
  const bioChanged = savedBio !== undefined && bio !== savedBio;
  const nameChanged = displayName !== saved.displayName;
  const changed = nameChanged || usernameChanged || bioChanged;
  // Conferência do @ que está no campo agora (a resposta de um texto antigo não vale).
  const current = check && typed === username.trim() ? check : undefined;
  const usernameProblem = usernameChanged && current && !current.available ? (current.problem ?? 'Esse @usuário já está em uso') : undefined;

  async function save() {
    if (busy || !changed) return;
    if (note.trim() === '') {
      setNoteMissing(true);
      return;
    }
    if (usernameProblem) return;
    setBusy(true);
    setError(undefined);
    try {
      // Confere de novo na hora de salvar: o @ pode ter sido pego enquanto o formulário estava aberto.
      if (usernameChanged) {
        const r = await api.usernameAvailableFor(user.id, username.trim());
        if (!r.available) {
          setCheck(r);
          setBusy(false);
          return;
        }
      }
      const nextBio = bio.trim() === '' ? null : bio;
      await api.editUser(user.id, {
        ...(nameChanged ? { displayName } : {}),
        ...(usernameChanged ? { username: username.trim() } : {}),
        ...(bioChanged ? { bio: nextBio } : {}),
        note: note.trim(),
      });
      setSaved({ displayName, username: usernameChanged ? username.trim().toLowerCase() : saved.username });
      if (bioChanged) setSavedBio(nextBio ?? '');
      setEditing(false);
      setBusy(false);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

  const providers = user.loginProviders ?? [];

  return (
    <Modal title={editing ? `Editar @${saved.username}` : `@${saved.username}`} onClose={onClose}>
      {editing ? (
        <div className="modal__body">
          <p className="muted small">Use para corrigir um nome ou @ ofensivo, de outra marca, ou a pedido da pessoa. O que mudou fica na auditoria.</p>
        </div>
      ) : null}
      <dl className="facts">
        <dt>{editing ? <label htmlFor={ids.name}>Nome</label> : 'Nome'}</dt>
        <dd>
          {editing ? (
            <div className="field field--inline">
              <input id={ids.name} value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          ) : (
            <strong>{saved.displayName}</strong>
          )}
        </dd>
        <dt>{editing ? <label htmlFor={ids.user}>@usuário</label> : '@usuário'}</dt>
        <dd>
          {editing ? (
            <div className="field field--inline">
              <input
                id={ids.user}
                value={username}
                maxLength={30}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={usernameProblem ? true : undefined}
                aria-describedby={`${ids.user}-hint`}
              />
              <span id={`${ids.user}-hint`} className={usernameProblem ? 'small alert' : 'muted small'} aria-live="polite">
                {!usernameChanged ? '' : usernameProblem ? usernameProblem : current?.available ? `@${current.username} está livre` : 'Conferindo…'}
              </span>
            </div>
          ) : (
            <span className="handle">@{saved.username}</span>
          )}
        </dd>
        <dt>{editing ? <label htmlFor={ids.bio}>Biografia</label> : 'Biografia'}</dt>
        <dd>
          {editing ? (
            <div className="field field--inline">
              <textarea id={ids.bio} rows={3} maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
          ) : savedBio === undefined ? (
            <span className="muted">Carregando…</span>
          ) : savedBio === '' ? (
            <span className="muted">Sem biografia</span>
          ) : (
            <span className="pre">{savedBio}</span>
          )}
        </dd>
        <dt>E-mail</dt>
        <dd>{user.email}</dd>
        <dt>Situação</dt>
        <dd>
          <Badge tone={user.status === 'ACTIVE' ? 'ok' : user.status === 'SUSPENDED' ? 'bad' : 'warn'}>{STATUS_LABEL[user.status]}</Badge>
        </dd>
        <dt>Papel</dt>
        <dd>{user.role === 'ADMIN' ? <Badge tone="admin">Admin</Badge> : ROLE_LABEL[user.role]}</dd>
        <dt>Login</dt>
        <dd>
          {providers.length === 0
            ? 'E-mail e senha'
            : providers.map((p) => (
                <span key={p}>
                  <Badge tone="info">{p === 'APPLE' ? 'Apple' : 'Google'}</Badge>{' '}
                </span>
              ))}
        </dd>
        <dt>Nascimento</dt>
        <dd>{user.birthDate ? formatBirthDate(user.birthDate) : <span className="muted">Não informado</span>}</dd>
        <dt>Posts</dt>
        <dd>{user.postsCount}</dd>
        <dt>Denúncias</dt>
        <dd>{user.reportsCount > 0 ? <strong className="alert">{user.reportsCount}</strong> : 0}</dd>
        <dt>Desde</dt>
        <dd>{formatDate(user.createdAt)}</dd>
      </dl>
      {editing ? (
        <div className="field">
          <label htmlFor={ids.note}>Motivo (obrigatório)</label>
          <textarea
            id={ids.note}
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim() !== '') setNoteMissing(false);
            }}
            aria-invalid={noteMissing ? true : undefined}
          />
          {noteMissing ? (
            <span className="small alert" role="alert">
              Escreva o motivo para salvar.
            </span>
          ) : (
            <span className="muted small">{note.length}/300 · fica registrado na auditoria</span>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--bad" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal__actions">
        {editing ? (
          <>
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !changed || usernameProblem !== undefined} aria-busy={busy || undefined}>
              {busy ? 'Aguarde…' : 'Salvar'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Fechar
            </button>
            {canEdit ? (
              <button type="button" className="btn btn--primary" onClick={startEdit} disabled={savedBio === undefined}>
                Editar
              </button>
            ) : null}
          </>
        )}
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
