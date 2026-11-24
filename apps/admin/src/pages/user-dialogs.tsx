import { useEffect, useState } from 'react';
import { ApiError, api, avatarSrc } from '../api.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import type { ReactNode } from 'react';
import { CLAIM_LABEL, STATUS_LABEL, formatBirthDate, formatCents, formatDate, formatDateTime, plural } from '../labels.ts';
import type { PersonRef, UserActivityItem, UserDetail as UserDetailData, UserRow, UserStats as UserStatsData } from '../types.ts';
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** "hoje", "ontem", "há 5 dias", "há 3 meses": quanto tempo faz, para ler de relance. */
export function sinceText(iso: string | null, now = Date.now()): string {
  if (!iso) return 'nunca';
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 60) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 24) return `há ${months} meses`;
  return `há ${Math.floor(days / 365)} anos`;
}

/** Idade da conta em dias, meses ou anos. */
export function ageText(days: number): string {
  if (days < 1) return 'menos de 1 dia';
  if (days < 60) return plural(days, 'dia', 'dias');
  if (days < 730) return plural(Math.floor(days / 30), 'mês', 'meses');
  return plural(Math.floor(days / 365), 'ano', 'anos');
}

/** Sinais que pedem um olhar de quem modera, do mais grave ao mais leve. */
export function attentionSignals(s: UserStatsData, now = Date.now()): { tone: 'bad' | 'warn' | 'info'; text: string }[] {
  const m = s.moderation;
  const out: { tone: 'bad' | 'warn' | 'info'; text: string }[] = [];
  if (m.reportsOpen > 0) out.push({ tone: 'bad', text: `${plural(m.reportsOpen, 'denúncia aberta', 'denúncias abertas')} contra a pessoa` });
  if (m.reportsActioned > 0) out.push({ tone: 'bad', text: `${plural(m.reportsActioned, 'denúncia confirmada', 'denúncias confirmadas')} pela gestão` });
  if (m.suspensions > 0) out.push({ tone: 'warn', text: `Já foi suspensa ${m.suspensions === 1 ? '1 vez' : `${m.suspensions} vezes`} (última ${formatDate(m.lastSuspendedAt)})` });
  if (m.blockedBy >= 3) out.push({ tone: 'warn', text: `Bloqueada por ${plural(m.blockedBy, 'pessoa', 'pessoas')}` });
  if (s.now.hiddenBy >= 3) out.push({ tone: 'warn', text: `${plural(s.now.hiddenBy, 'pessoa escondeu', 'pessoas esconderam')} o NOW dela` });
  if (m.reportsMade >= 5 && m.reportsMadeActioned === 0) out.push({ tone: 'info', text: `Fez ${m.reportsMade} denúncias e nenhuma foi confirmada` });
  if (s.accountAgeDays < 7 && s.actions7 >= 100) out.push({ tone: 'warn', text: `Conta nova com muita ação (${s.actions7} em 7 dias)` });
  const idle = s.lastSeenAt ? (now - new Date(s.lastSeenAt).getTime()) / DAY_MS : Infinity;
  if (idle > 30) out.push({ tone: 'info', text: s.lastSeenAt ? `Sem uso há mais de 30 dias` : 'Nenhuma ação registrada no app' });
  return out;
}

function Stat({ label, value, sub, alert }: { label: string; value: ReactNode; sub?: ReactNode; alert?: boolean }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={alert ? 'stat__value stat__value--alert' : 'stat__value'}>{value}</span>
      {sub ? <span className="stat__sub">{sub}</span> : null}
    </div>
  );
}

function StatGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stats__group">
      <h3 className="stats__title">{title}</h3>
      <div className="stats__grid">{children}</div>
    </section>
  );
}

/** Retrato da pessoa para quem gerencia: uso, vínculos, eventos, NOW, mensagens (só quantas), moderação e compras. */
export function UserStatsPanel({ userId }: { userId: string }) {
  const state = useAsync(() => api.userStats(userId), [userId]);
  if (state.loading && !state.data) return <p className="muted small">Carregando números…</p>;
  if (state.error) return <p className="notice notice--bad" role="alert">{state.error}</p>;
  const s = state.data;
  if (!s) return null;
  const m = s.moderation;
  const signals = attentionSignals(s);
  const rate = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—');
  return (
    <div className="stats">
      {signals.length > 0 ? (
        <ul className="stats__signals" aria-label="Pontos de atenção">
          {signals.map((x) => (
            <li key={x.text}>
              <Badge tone={x.tone}>{x.tone === 'bad' ? 'Atenção' : x.tone === 'warn' ? 'Observar' : 'Info'}</Badge> {x.text}
            </li>
          ))}
        </ul>
      ) : null}
      <StatGroup title="Uso">
        <Stat label="Visto por último" value={sinceText(s.lastSeenAt)} sub={s.lastSeenAt ? formatDateTime(s.lastSeenAt) : 'pela última ação ou visualização'} />
        <Stat label="Conta criada há" value={ageText(s.accountAgeDays)} />
        <Stat label="Dias ativos (30 dias)" value={`${s.activeDays30}/30`} />
        <Stat label="Ações" value={s.actions30} sub={`${s.actions7} nos últimos 7 dias`} />
      </StatGroup>
      <StatGroup title="Social">
        <Stat label="Amigos" value={s.social.friends} />
        <Stat label="Seguidores" value={s.social.followers} sub={`+${s.social.followersGained30} em 30 dias`} />
        <Stat label="Segue" value={s.social.following} />
        <Stat label="Curtidas e reações recebidas" value={s.social.likesReceived} />
        <Stat label="Comentários recebidos" value={s.social.commentsReceived} />
        <Stat label="Convidou para o app" value={s.referrals.invited} sub={`${s.referrals.qualified} voltaram depois`} />
      </StatGroup>
      <StatGroup title="Conteúdo">
        <Stat label="Posts" value={s.content.posts} />
        <Stat label="Stories" value={s.content.stories} />
        <Stat label="Publicações no feed" value={s.content.feedPosts} />
        <Stat label="Comentários feitos" value={s.content.comments} />
        <Stat label="Curtidas e reações dadas" value={s.content.likes} />
      </StatGroup>
      <StatGroup title="Eventos">
        <Stat label="Criados" value={s.events.created} />
        <Stat label="Presenças confirmadas" value={s.events.going} />
        <Stat label="Check-ins em locais" value={s.events.checkins} />
        <Stat label="Convites para eventos" value={s.events.invitesSent} sub={`recebeu ${s.events.invitesReceived}`} />
        <Stat label="Enquetes de data" value={s.events.datePolls} />
        <Stat label="Chapelaria" value={s.events.cloakroomTickets} sub="etiquetas" />
      </StatGroup>
      <StatGroup title="NOW">
        <Stat label="Vezes que ligou" value={s.now.sessions} sub={`${s.now.sessions30} em 30 dias · último ${sinceText(s.now.lastAt)}`} />
        <Stat label="Convites enviados" value={s.now.invitesSent} sub={`recebeu ${s.now.invitesReceived}`} />
        <Stat label="Encontros aceitos" value={s.now.meetups} />
        <Stat label="Esconderam o NOW dela" value={s.now.hiddenBy} alert={s.now.hiddenBy >= 3} />
      </StatGroup>
      <StatGroup title="Mensagens">
        <Stat label="Conversas" value={s.messages.conversations} />
        <Stat label="Mensagens enviadas" value={s.messages.sent} sub={`${s.messages.sent30} em 30 dias`} />
      </StatGroup>
      <StatGroup title="Moderação">
        <Stat label="Denúncias recebidas" value={m.reportsReceived} sub={`${m.reportsOpen} abertas · ${m.reportsActioned} confirmadas`} alert={m.reportsOpen > 0 || m.reportsActioned > 0} />
        <Stat label="Denúncias feitas" value={m.reportsMade} sub={`${rate(m.reportsMadeActioned, m.reportsMade)} confirmadas`} />
        <Stat label="Bloqueada por" value={m.blockedBy} alert={m.blockedBy >= 3} />
        <Stat label="Bloqueou" value={m.blocksMade} />
        <Stat label="Suspensões" value={m.suspensions} sub={m.lastSuspendedAt ? `última em ${formatDate(m.lastSuspendedAt)}` : undefined} alert={m.suspensions > 0} />
      </StatGroup>
      <StatGroup title="Compras">
        <Stat label="Impulsionamentos pagos" value={s.purchases.boostsPaid} sub={s.purchases.lastPaidAt ? `último em ${formatDate(s.purchases.lastPaidAt)}` : undefined} />
        <Stat label="Total gasto" value={formatCents(s.purchases.spentCents)} />
        <Stat label="Pagamentos pendentes" value={s.purchases.boostsPending} />
      </StatGroup>
    </div>
  );
}

/** Os números e a atividade, abertos direto da lista de pessoas. */
export function UserActivityDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  return (
    <Modal title={`Atividade de @${user.username}`} onClose={onClose} wide>
      <UserStatsPanel userId={user.id} />
      <h3 className="stats__title">Linha do tempo</h3>
      <ActivityList userId={user.id} />
      <div className="modal__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}
