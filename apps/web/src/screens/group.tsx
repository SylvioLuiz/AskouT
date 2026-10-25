import { useRef, useState } from 'react';
import { FriendPicker, ManageMeetupSheet } from '../components/meetup.tsx';
import { GroupPolls } from '../components/date-poll-summary.tsx';
import { GroupEvent, SharedLinks, SharedMedia } from '../components/shared-tabs.tsx';
import { Sheet } from '../components/agenda.tsx';
import { EditIcon, MoreIcon } from '../components/icons.tsx';
import { Button, EmptyState, ErrorState, Field, GroupAvatar, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { useUser } from '../auth.tsx';
import { toApiError } from '../lib/errors.ts';
import { resizeGroupPhoto } from '../lib/image.ts';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { peopleLabel, toggleId } from '../lib/meetup.ts';
import type { MeetupView } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

type Tab = 'people' | 'events' | 'media' | 'links';

/** Detalhes do grupo: pessoas, eventos e mídia. Abre ao tocar no nome do grupo na conversa. */
export function GroupScreen({ conversationId }: { conversationId: string }) {
  const group = useAsync(() => api.group(conversationId), [conversationId]);
  usePolling(group.reload, 15_000);
  const shared = useAsync(() => api.shared(conversationId), [conversationId]);
  const polls = useAsync(() => api.conversationPolls(conversationId), [conversationId]);
  const me = useUser();
  const [tab, setTab] = useState<Tab>('people');
  const [sheet, setSheet] = useState<'edit' | 'leave' | 'delete' | 'add' | { member: string } | { remove: string } | { block: string } | { meetup: MeetupView } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useTitle(group.data?.name ?? t('Grupo'));

  if (group.loading && !group.data) return <Loading />;
  if (group.error && !group.data) {
    return (
      <>
        <PageHead title={t('Grupo')} back={`/conversas/${conversationId}`} />
        {group.error.code === 'NOT_FOUND' ? (
          <EmptyState title={t('Grupo não encontrado')}>{t('Só quem está no grupo vê os detalhes. Você entra no grupo ao aceitar o convite do encontro.')}</EmptyState>
        ) : (
          <ErrorState message={group.error.message} onRetry={group.reload} />
        )}
      </>
    );
  }
  const data = group.data!;
  // O encontro gerado por uma votação aparece pela votação (ou pelo evento dela), nunca os dois.
  const pollMeetups = new Set((polls.data?.items ?? []).flatMap((p) => (p.meetupId ? [p.meetupId] : [])));
  const visibleMeetups = data.meetups.filter((m) => !pollMeetups.has(m.id));
  const isOwner = data.ownerId === me.id;
  const memberOf = (userId: string) => data.members.find((m) => m.profile.userId === userId);

  async function act(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setProblem(undefined);
    try {
      await work();
      setSheet(undefined);
      group.reload();
      after?.();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    await act(async () => api.setGroupPhoto(conversationId, await resizeGroupPhoto(file)));
    if (fileRef.current) fileRef.current.value = '';
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'people', label: t('Pessoas') },
    { id: 'events', label: t('Eventos') },
    { id: 'media', label: t('Mídia') },
    { id: 'links', label: t('Links') },
  ];

  return (
    <>
      <PageHead
        title={data.name}
        back={`/conversas/${conversationId}`}
        subtitle={peopleLabel(data.members.length)}
        action={
          data.canManage ? (
            <button type="button" className="iconbtn" aria-label={t('Editar nome e foto do grupo')} onClick={() => { setName(data.name); setProblem(undefined); setSheet('edit'); }}>
              <EditIcon />
            </button>
          ) : undefined
        }
      />
      <div className="grouphead">
        <GroupAvatar name={data.name} size={96} imageUrl={data.imageUrl} />
      </div>
      {problem && !sheet ? <p className="sugcard__problem" role="alert">{problem}</p> : null}
      <div className="segtabs segtabs--fill" role="tablist" aria-label={t('Detalhes do grupo')}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'people' ? (
        <>
          <div className="peoplehead">
            <h2 className="results__h">{t('Participantes')}</h2>
            {data.canManage ? (
              <button type="button" className="peoplehead__add" onClick={() => { setProblem(undefined); setPicked([]); setSheet('add'); }}>
                {t('Adicionar')}
              </button>
            ) : null}
          </div>
          <ul className="list">
            {data.members.map((m) => (
              <PersonRow key={m.profile.userId} profile={m.profile} realName aside={
                  <>
                    {m.role === 'OWNER' ? <span className="tag tag--event">{t('Criou o grupo')}</span> : m.role === 'ADMIN' ? <span className="tag tag--event">{t('Administrador')}</span> : null}
                    {m.profile.userId !== me.id ? (
                      <button type="button" className="iconbtn" aria-label={t('Opções de {displayName}', { displayName: m.profile.displayName })} onClick={() => { setProblem(undefined); setSheet({ member: m.profile.userId }); }}>
                        <MoreIcon />
                      </button>
                    ) : null}
                  </>
                }
              />
            ))}
          </ul>
          <p className="muted">{t('Entra no grupo quem aceita o convite do encontro ou quem o criador ou um administrador adiciona.')}</p>
          <button type="button" className="groupleave" onClick={() => { setProblem(undefined); setSheet('leave'); }}>
            {t('Sair do grupo')}
          </button>
          {isOwner ? (
            <button type="button" className="groupleave" onClick={() => { setProblem(undefined); setSheet('delete'); }}>
              {t('Apagar grupo para todos')}
            </button>
          ) : null}
        </>
      ) : null}

      {tab === 'events' ? <GroupPolls items={polls.data?.items ?? []} /> : null}
      {tab === 'events' ? (
        visibleMeetups.length === 0 && (polls.data?.items.length ?? 0) === 0 ? (
          <EmptyState title={t('Nenhum evento no grupo')}>{t('Os encontros marcados com este grupo aparecem aqui.')}</EmptyState>
        ) : (
          <ul className="groupevents">
            {visibleMeetups.map((m) => (
              <GroupEvent key={m.id} meetup={m} onManage={m.canManage ? () => { setProblem(undefined); setSheet({ meetup: m }); } : undefined} />
            ))}
          </ul>
        )
      ) : null}

      {tab === 'media' || tab === 'links' ? (
        shared.data ? (
          tab === 'media' ? <SharedMedia voice={shared.data.voice} media={shared.data.media} conversationId={conversationId} /> : <SharedLinks links={shared.data.links} />
        ) : shared.error ? (
          <ErrorState message={shared.error.message} onRetry={shared.reload} />
        ) : (
          <Loading />
        )
      ) : null}

      {sheet === 'edit' ? (
        <Sheet title={t('Editar grupo')} onClose={() => setSheet(undefined)}>
          <div className="groupedit">
            <div className="groupedit__photo">
              <GroupAvatar name={data.name} size={96} imageUrl={data.imageUrl} />
              <div className="groupedit__actions">
                <span className="btn btn--secondary btn--small filebtn">
                  {data.imageUrl ? t('Trocar foto') : t('Adicionar foto')}
                  <input ref={fileRef} type="file" accept="image/*" aria-label={data.imageUrl ? t('Trocar foto do grupo') : t('Adicionar foto do grupo')} onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                </span>
                {data.imageUrl ? (
                  <Button small variant="quiet" onClick={() => void act(() => api.setGroupPhoto(conversationId, null))}>
                    {t('Remover foto')}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="groupedit__form">
              <Field label={t('Nome do grupo')} value={name} onChange={setName} maxLength={60} />
              <Button full loading={busy} disabled={name.trim() === '' || name.trim() === data.name} onClick={() => void act(() => api.renameGroup(conversationId, name.trim()))}>
                {t('Salvar nome')}
              </Button>
            </div>
          </div>
          {problem ? <p className="sugcard__problem" role="alert">{problem}</p> : null}
        </Sheet>
      ) : null}

      {sheet && typeof sheet === 'object' && 'member' in sheet ? (
        (() => {
          const target = memberOf(sheet.member);
          if (!target) return null;
          const canPromote = data.canManage && target.role === 'MEMBER';
          const canDemote = isOwner && target.role === 'ADMIN';
          const canRemove = data.canManage && target.role !== 'OWNER' && (isOwner || target.role === 'MEMBER');
          const targetId = target.profile.userId;
          return (
            <Sheet title={target.profile.displayName} onClose={() => setSheet(undefined)}>
              {problem ? <p className="sugcard__problem" role="alert">{problem}</p> : null}
              <ul className="sharelist">
                {canPromote ? (
                  <li>
                    <button type="button" className="sharelist__item" disabled={busy} onClick={() => void act(() => api.setGroupAdmin(conversationId, targetId, true))}>
                      <strong>{t('Tornar administrador')}</strong>
                      <span>{t('Pode editar o grupo e remover participantes.')}</span>
                    </button>
                  </li>
                ) : null}
                {canDemote ? (
                  <li>
                    <button type="button" className="sharelist__item" disabled={busy} onClick={() => void act(() => api.setGroupAdmin(conversationId, targetId, false))}>
                      <strong>{t('Remover como administrador')}</strong>
                    </button>
                  </li>
                ) : null}
                {target.follow === 'NONE' ? (
                  <li>
                    <button type="button" className="sharelist__item" disabled={busy} onClick={() => void act(() => api.follow(targetId))}>
                      <strong>{t('Seguir')}</strong>
                    </button>
                  </li>
                ) : null}
                {canRemove ? (
                  <li>
                    <button type="button" className="sharelist__item sharelist__item--danger" onClick={() => { setProblem(undefined); setSheet({ remove: targetId }); }}>
                      <strong>{t('Remover do grupo')}</strong>
                    </button>
                  </li>
                ) : null}
                <li>
                  <button type="button" className="sharelist__item sharelist__item--danger" onClick={() => { setProblem(undefined); setSheet({ block: targetId }); }}>
                    <strong>{t('Bloquear')}</strong>
                  </button>
                </li>
              </ul>
            </Sheet>
          );
        })()
      ) : null}

      {sheet && typeof sheet === 'object' && 'block' in sheet ? (
        <Sheet title={t('Bloquear')} onClose={() => setSheet(undefined)}>
          <p className="muted">
            {memberOf(sheet.block)?.profile.displayName ?? t('Essa pessoa')} deixa de ver você e você deixa de ver essa pessoa, inclusive neste grupo. Vocês deixam de se seguir. Dá para desbloquear depois nas configurações.
          </p>
          {problem ? <p className="sugcard__problem" role="alert">{problem}</p> : null}
          <Button full variant="danger" loading={busy} onClick={() => void act(() => api.block(sheet.block))}>
            {t('Bloquear')}
          </Button>
        </Sheet>
      ) : null}

      {sheet === 'add' ? (
        <Sheet title={t('Adicionar ao grupo')} onClose={() => setSheet(undefined)}>
          <FriendPicker picked={picked} onToggle={(userId) => setPicked((cur) => toggleId(cur, userId))} exclude={data.members.map((m) => m.profile.userId)} />
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full loading={busy} disabled={picked.length === 0} onClick={() => void act(() => api.addGroupMembers(conversationId, picked))}>
            {picked.length > 1 ? t('Adicionar {length} pessoas', { length: picked.length }) : t('Adicionar')}
          </Button>
        </Sheet>
      ) : null}

      {sheet === 'leave' ? (
        <Sheet title={t('Sair do grupo')} onClose={() => setSheet(undefined)}>
          <p className="muted">
            Você deixa de ver as mensagens do grupo e sai dos encontros dele.{isOwner && data.members.length > 1 ? ' Outra pessoa passa a administrar o grupo.' : ''} Para voltar, só com um novo convite.
          </p>
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full variant="danger" loading={busy} onClick={() => void act(() => api.leaveGroup(conversationId), () => navigate('/conversas'))}>
            {t('Sair do grupo')}
          </Button>
        </Sheet>
      ) : null}

      {sheet === 'delete' ? (
        <Sheet title={t('Apagar grupo')} onClose={() => setSheet(undefined)}>
          <p className="muted">{t('O grupo e todas as mensagens dele são apagados para todo mundo, e não dá para desfazer. Os outros participantes recebem um aviso. Os encontros já marcados continuam na agenda de cada um.')}</p>
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full variant="danger" loading={busy} onClick={() => void act(() => api.deleteGroup(conversationId), () => navigate('/conversas'))}>
            {t('Apagar grupo para todos')}
          </Button>
        </Sheet>
      ) : null}

      {sheet && typeof sheet === 'object' && 'remove' in sheet ? (
        <Sheet title={t('Remover do grupo')} onClose={() => setSheet(undefined)}>
          <p className="muted">{data.members.find((m) => m.profile.userId === sheet.remove)?.profile.displayName ?? 'Essa pessoa'} sai do grupo e dos encontros dele.</p>
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full variant="danger" loading={busy} onClick={() => void act(() => api.removeMember(conversationId, sheet.remove))}>
            {t('Remover')}
          </Button>
        </Sheet>
      ) : null}

      {sheet && typeof sheet === 'object' && 'meetup' in sheet ? (
        <ManageMeetupSheet meetup={sheet.meetup} excludeIds={data.members.map((m) => m.profile.userId)} onClose={() => setSheet(undefined)} onChanged={() => group.reload()} />
      ) : null}
    </>
  );
}
