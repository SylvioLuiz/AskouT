import { useEffect, useState } from 'react';
import { ApiError, api, avatarSrc } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { CLAIM_LABEL, STATUS_LABEL, formatBirthDate, formatDate, formatDateTime, plural } from '../labels.ts';
import type { PersonRef, UserActivityItem, UserDetail as UserDetailData, UserRow } from '../types.ts';
import { Badge, Modal } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';
import { DateInput, LinkedList, Mono, PersonLink, RecordLink, RecordModal, RecordView, TextArea, TextInput, YesNo, useRecordEditor } from '../record.tsx';
import type { RecordAction, RecordSection } from '../record.tsx';

export const ROLE_LABEL: Record<UserRow['role'], string> = { USER: 'Pessoa', VENUE_OWNER: 'Responsável por local', ADMIN: 'Admin' };
const VENUE_ROLE_LABEL = { OWNER: 'Dono', MANAGER: 'Administra', FOLLOWER: 'Segue' } as const;
const GROUP_ROLE_LABEL: Record<string, string> = { OWNER: 'Dono', ADMIN: 'Admin', MEMBER: 'Membro' };

export function statusTone(status: UserRow['status']): 'ok' | 'bad' | 'warn' {
  return status === 'ACTIVE' ? 'ok' : status === 'SUSPENDED' ? 'bad' : 'warn';
}

export function suspendAction(u: { id: string; username: string }): ActionSpec {
  return {
    title: `Suspender @${u.username}`,
    description: <p>A conta perde o acesso agora: as sessões abertas caem e o login fica bloqueado até você reativar.</p>,
    confirmLabel: 'Suspender',
    danger: true,
    noteLabel: 'Motivo',
    noteRequired: true,
    run: (note) => api.setUserStatus(u.id, 'SUSPENDED', note),
  };
}

export function reactivateAction(u: { id: string; username: string }): ActionSpec {
  return {
    title: `Reativar @${u.username}`,
    description: <p>A conta volta a poder entrar no AskouT.</p>,
    confirmLabel: 'Reativar',
    noteLabel: 'Nota',
    run: (note) => api.setUserStatus(u.id, 'ACTIVE', note),
  };
}

function People({ items, total, empty }: { items: PersonRef[]; total: number; empty: string }) {
  return (
    <LinkedList
      items={items}
      total={total}
      empty={empty}
      keyOf={(p) => p.id}
      render={(p) => ({ main: <PersonLink id={p.id} username={p.username} displayName={p.displayName} />, side: `desde ${formatDate(p.at)}` })}
    />
  );
}

type UserDraft = { displayName: string; username: string; bio: string; birthDate: string };

/**
 * Uma pessoa inteira: cadastro, conta, configurações, vínculos (amigos, seguidores, eventos, posts, locais, grupos) e a
 * atividade. "Editar" deixa nome, @usuário, biografia e data de nascimento editáveis; o motivo vai para a auditoria.
 */
export function UserDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAsync(() => api.userDetail(id), [id]);
  return (
    <RecordModal state={detail} label="Pessoa" onClose={onClose}>
      {(u) => <UserRecord u={u} onClose={onClose} reload={detail.reload} />}
    </RecordModal>
  );
}

function UserRecord({ u, onClose, reload }: { u: UserDetailData; onClose: () => void; reload: () => void }) {
  const x = u.extra;
  // O @ novo é conferido enquanto se digita: livre, já em uso ou fora do formato.
  const [check, setCheck] = useState<{ username: string; available: boolean; problem?: string }>();
  const problemOf = (typedName: string) => {
    const name = typedName.trim().toLowerCase();
    if (name === u.username || !check || check.username !== name || check.available) return undefined;
    return check.problem ?? 'Esse @usuário já está em uso';
  };
  const editor = useRecordEditor<UserDraft>({
    initial: { displayName: u.displayName, username: u.username, bio: u.bio ?? '', birthDate: u.birthDate ?? '' },
    save: async (changes, note) => {
      const profile = { ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}), ...(changes.username !== undefined ? { username: changes.username.trim() } : {}), ...(changes.bio !== undefined ? { bio: changes.bio.trim() === '' ? null : changes.bio } : {}) };
      if (Object.keys(profile).length > 0) await api.editUser(u.id, { ...profile, note });
      if (changes.birthDate !== undefined) await api.setUserBirthDate(u.id, changes.birthDate, note);
    },
    check: (d) => ({ ...(problemOf(d.username) ? { username: problemOf(d.username)! } : {}), ...(d.birthDate === '' && u.birthDate ? { birthDate: 'Informe a data' } : {}) }),
    onSaved: reload,
  });

  const typed = useDebounced(editor.draft.username.trim());
  const usernameChanged = editor.editing && editor.draft.username.trim().toLowerCase() !== u.username;
  useEffect(() => {
    setCheck(undefined);
    if (!usernameChanged || typed === '') return;
    let alive = true;
    api.usernameAvailableFor(u.id, typed).then((r) => alive && setCheck(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [usernameChanged, typed, u.id]);
  const current = check && check.username === editor.draft.username.trim().toLowerCase() ? check : undefined;
  const usernameProblem = usernameChanged ? problemOf(editor.draft.username) : undefined;
  const usernameHint = !usernameChanged ? undefined : current?.available ? `@${current.username} está livre` : usernameProblem ? undefined : 'Conferindo…';

  const isAdmin = u.role === 'ADMIN';
  const providers = x?.loginProviders ?? [];
  const actions: RecordAction[] = [
    { label: 'Suspender', confirm: suspendAction(u), danger: true, hidden: isAdmin || u.status === 'SUSPENDED' },
    { label: 'Reativar', confirm: reactivateAction(u), hidden: isAdmin || u.status !== 'SUSPENDED' },
  ];
  const c = x?.counts;

  const sections: RecordSection[] = [
    {
      title: 'Perfil',
      fields: [
        { label: 'Nome', value: <strong>{u.displayName}</strong>, input: <TextInput editor={editor} k="displayName" maxLength={60} />, problem: editor.problems.displayName },
        { label: '@usuário', value: <span className="handle">@{u.username}</span>, input: <TextInput editor={editor} k="username" maxLength={30} />, problem: editor.problems.username, hint: usernameHint },
        { label: 'Biografia', value: u.bio ? <span className="pre">{u.bio}</span> : null, input: <TextArea editor={editor} k="bio" maxLength={160} />, wide: true, problem: editor.problems.bio },
        { label: 'Foto', value: x?.avatarUrl ? <img className="record__avatar" src={avatarSrc(x.avatarUrl)} alt="" referrerPolicy="no-referrer" /> : null },
        { label: 'Perfil privado', value: <YesNo value={x?.isPrivate} /> },
        { label: 'Gostos de rolê', value: x && x.tastes.length > 0 ? x.tastes.join(', ') : x ? 'Gosta de tudo' : null, wide: true },
      ],
    },
    {
      title: 'Conta',
      fields: [
        { label: 'E-mail', value: u.email },
        { label: 'Situação', value: <Badge tone={statusTone(u.status)}>{STATUS_LABEL[u.status]}</Badge> },
        { label: 'Papel', value: isAdmin ? <Badge tone="admin">Admin</Badge> : ROLE_LABEL[u.role] },
        { label: 'Nascimento', value: u.birthDate ? formatBirthDate(u.birthDate) : null, input: <DateInput editor={editor} k="birthDate" max={new Date().toISOString().slice(0, 10)} />, hint: 'Só para erro de digitação, depois de conferir com a pessoa (18 anos ou mais).', problem: editor.problems.birthDate },
        { label: 'Celular', value: x?.phone ?? null },
        { label: 'Celular confirmado em', value: x?.phoneVerifiedAt ? formatDateTime(x.phoneVerifiedAt) : null },
        {
          label: 'Login',
          value:
            providers.length === 0
              ? 'E-mail e senha'
              : providers.map((p) => (
                  <span key={p}>
                    <Badge tone="info">{p === 'APPLE' ? 'Apple' : 'Google'}</Badge>{' '}
                  </span>
                )),
        },
        { label: 'Sem senha', value: <YesNo value={x?.passwordless} /> },
        { label: 'Duas etapas (app autenticador)', value: <YesNo value={x?.mfaEnabled} /> },
        { label: 'Cadastro pendente', value: <YesNo value={x?.profilePending} /> },
        { label: 'Termos aceitos', value: x?.termsAcceptedAt ? `${formatDateTime(x.termsAcceptedAt)}${x.termsVersion ? ` · versão ${x.termsVersion}` : ''}` : null },
        { label: 'Tutorial', value: x?.onboardedAt ? `Visto em ${formatDateTime(x.onboardedAt)}` : x ? 'Ainda não viu' : null },
        { label: 'Convidada por', value: x?.invitedBy ? <PersonLink id={x.invitedBy.id} username={x.invitedBy.username} /> : null },
        { label: 'Criada em', value: formatDateTime(u.createdAt) },
        { label: 'Atualizada em', value: x ? formatDateTime(x.updatedAt) : null },
        { label: 'ID', value: <Mono>{u.id}</Mono> },
      ],
    },
    {
      title: 'Configurações',
      hidden: !x,
      fields: [
        { label: 'Fuso horário', value: x?.settings?.timeZone ?? 'America/Sao_Paulo (padrão)' },
        { label: 'Mostra a agenda aos amigos', value: <YesNo value={x?.settings?.shareAvailability ?? false} /> },
        { label: 'Mensagens de quem não segue', value: <YesNo value={x?.settings?.openDms ?? false} /> },
        { label: 'Região', value: x?.region ? `${x.region.lat.toFixed(3)}, ${x.region.lng.toFixed(3)} · ${formatDate(x.region.updatedAt)}` : null },
      ],
    },
    {
      title: 'Números',
      hidden: !c,
      fields: c
        ? [
            { label: 'Amigos', value: c.friends },
            { label: 'Seguidores', value: c.followers },
            { label: 'Segue', value: c.following },
            { label: 'Pedidos para seguir', value: c.followRequests },
            { label: 'Posts', value: c.posts },
            { label: 'Eventos criados', value: c.eventsCreated },
            { label: 'Presenças confirmadas', value: c.eventsGoing },
            { label: 'Publicações no feed', value: c.feedPosts },
            { label: 'Comentários', value: c.postComments },
            { label: 'Curtidas', value: c.postLikes },
            { label: 'Stories', value: c.stories },
            { label: 'Locais que segue', value: c.venuesFollowed },
            { label: 'Locais (dono)', value: c.venuesOwned },
            { label: 'Locais (administra)', value: c.venuesManaged },
            { label: 'Pedidos de dono', value: c.claims },
            { label: 'Denúncias feitas', value: c.reportsMade },
            { label: 'Denúncias recebidas', value: c.reportsReceived > 0 ? <strong className="alert">{c.reportsReceived}</strong> : 0 },
            { label: 'Bloqueou', value: c.blocksMade },
            { label: 'Bloqueada por', value: c.blockedBy },
            { label: 'Grupos', value: c.groups },
            { label: 'Conversas', value: c.conversations },
            { label: 'Mensagens', value: c.messages },
            { label: 'Convidou', value: plural(c.referrals, 'pessoa', 'pessoas') },
          ]
        : [],
    },
    { title: 'Amigos', count: c?.friends, hidden: !x, children: x ? <People items={x.friends} total={x.counts.friends} empty="Nenhum amigo (ninguém que se sigam um ao outro)." /> : null },
    { title: 'Seguidores', count: c?.followers, hidden: !x, children: x ? <People items={x.followers} total={x.counts.followers} empty="Ninguém segue." /> : null },
    { title: 'Segue', count: c?.following, hidden: !x, children: x ? <People items={x.following} total={x.counts.following} empty="Não segue ninguém." /> : null },
    { title: 'Pedidos para seguir', count: c?.followRequests, hidden: !x || x.counts.followRequests === 0, children: x ? <People items={x.followRequests} total={x.counts.followRequests} empty="" /> : null },
    {
      title: 'Eventos criados',
      count: c?.eventsCreated,
      hidden: !x,
      children: x ? (
        <LinkedList
          items={x.eventsCreated}
          total={x.counts.eventsCreated}
          empty="Nenhum evento criado."
          keyOf={(e) => e.id}
          render={(e) => ({
            main: (
              <RecordLink kind="post" id={e.id}>
                <strong>{e.title}</strong> {e.private ? <Badge>Privado</Badge> : null}
              </RecordLink>
            ),
            side: e.startsAt ? formatDateTime(e.startsAt) : 'sem data',
            past: e.endsAt ? new Date(e.endsAt).getTime() < Date.now() : false,
          })}
        />
      ) : null,
    },
    {
      title: 'Eventos que confirmou',
      count: c?.eventsGoing,
      hidden: !x,
      children: x ? (
        <LinkedList
          items={x.eventsGoing}
          total={x.counts.eventsGoing}
          empty="Nenhuma presença confirmada."
          keyOf={(e) => `${e.source}-${e.id}`}
          render={(e) => ({
            main: (
              <>
                <RecordLink kind={e.source === 'PLACE' ? 'event' : 'post'} id={e.id}>
                  <strong>{e.title}</strong>
                </RecordLink>{' '}
                <span className="muted small">{e.source === 'PLACE' ? `no local${e.venueName ? ` ${e.venueName}` : ''}` : `de pessoa${e.venueName ? ` · ${e.venueName}` : ''}`}</span>
              </>
            ),
            side: `${e.startsAt ? formatDateTime(e.startsAt) : 'sem data'} · confirmou em ${formatDate(e.at)}`,
            past: e.startsAt ? new Date(e.startsAt).getTime() < Date.now() : false,
          })}
        />
      ) : null,
    },
    {
      title: 'Posts',
      count: c?.posts,
      hidden: !x,
      children: x ? (
        <LinkedList
          items={x.posts}
          total={x.counts.posts}
          empty="Nenhum post."
          keyOf={(p) => p.id}
          render={(p) => ({
            main: (
              <RecordLink kind="post" id={p.id}>
                {p.eventTitle ? <strong>{p.eventTitle}</strong> : <span className="clip">{p.caption ?? 'Sem legenda'}</span>}
              </RecordLink>
            ),
            side: `${formatDateTime(p.createdAt)}${p.archived ? ' · arquivado' : ''}`,
          })}
        />
      ) : null,
    },
    {
      title: 'Locais',
      hidden: !x || x.venues.length === 0,
      children: x ? (
        <LinkedList
          items={x.venues}
          empty=""
          keyOf={(v) => `${v.role}-${v.id}`}
          render={(v) => ({ main: <RecordLink kind="venue" id={v.id}>{v.name}</RecordLink>, side: VENUE_ROLE_LABEL[v.role] })}
        />
      ) : null,
    },
    {
      title: 'Pedidos para administrar local',
      count: c?.claims,
      hidden: !x || x.claims.length === 0,
      children: x ? (
        <LinkedList
          items={x.claims}
          empty=""
          keyOf={(cl) => cl.id}
          render={(cl) => ({ main: <RecordLink kind="venue" id={cl.venueId}>{cl.venueName}</RecordLink>, side: `${CLAIM_LABEL[cl.status]} · ${formatDate(cl.createdAt)}` })}
        />
      ) : null,
    },
    {
      title: 'Grupos',
      count: c?.groups,
      hidden: !x || x.groups.length === 0,
      children: x ? <LinkedList items={x.groups} total={x.counts.groups} empty="" keyOf={(g) => g.id} render={(g) => ({ main: g.name, side: `${GROUP_ROLE_LABEL[g.role] ?? g.role} · desde ${formatDate(g.joinedAt)}` })} /> : null,
    },
    { title: 'Atividade', children: <ActivityList userId={u.id} compact /> },
  ];

  return (
    <RecordView
      title={u.displayName || `@${u.username}`}
      subtitle={<span className="handle">@{u.username}</span>}
      status={
        <>
          <Badge tone={statusTone(u.status)}>{STATUS_LABEL[u.status]}</Badge> {isAdmin ? <Badge tone="admin">Admin</Badge> : null} {x?.isPrivate ? <Badge>Privado</Badge> : null}
        </>
      }
      sections={sections}
      actions={actions}
      editor={editor}
      canEdit={!isAdmin}
      editHint="Use para corrigir um nome ou @ ofensivo, de outra marca, ou a pedido da pessoa. O que mudou fica na auditoria."
      onClose={onClose}
      onChanged={reload}
    />
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
function ActivityList({ userId, compact }: { userId: string; compact?: boolean }) {
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<UserActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  async function load(nextKind: string, after: string | null) {
    setLoading(true);
    setError(undefined);
    try {
      const page = await api.userActivity(userId, { kind: nextKind, cursor: after });
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
  }, [kind, userId]);

  return (
    <div className={compact ? 'record__activity' : undefined}>
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
      {!loading && items.length === 0 && !error ? <p className="muted small">Nenhuma atividade.</p> : null}
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
      {cursor ? (
        <div className="row-actions">
          <button type="button" className="btn btn--small" onClick={() => void load(kind, cursor)} disabled={loading}>
            {loading ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A atividade sozinha, aberta direto da lista de pessoas. */
export function UserActivityDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  return (
    <Modal title={`Atividade de @${user.username}`} onClose={onClose} wide>
      <ActivityList userId={user.id} />
      <div className="modal__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
