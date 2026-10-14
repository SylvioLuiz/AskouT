import { useRef, useState } from 'react';
import { ManageMeetupSheet } from '../components/meetup.tsx';
import { GroupEvent, SharedLinks, SharedMedia } from '../components/shared-tabs.tsx';
import { Sheet } from '../components/agenda.tsx';
import { Button, EmptyState, ErrorState, Field, GroupAvatar, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { useUser } from '../auth.tsx';
import { toApiError } from '../lib/errors.ts';
import { resizeGroupPhoto } from '../lib/image.ts';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { peopleLabel } from '../lib/meetup.ts';
import type { MeetupView } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';

type Tab = 'people' | 'events' | 'media' | 'links';

/** Detalhes do grupo: pessoas, eventos e mídia. Abre ao tocar no nome do grupo na conversa. */
export function GroupScreen({ conversationId }: { conversationId: string }) {
  const group = useAsync(() => api.group(conversationId), [conversationId]);
  usePolling(group.reload, 15_000);
  const shared = useAsync(() => api.shared(conversationId), [conversationId]);
  const me = useUser();
  const [tab, setTab] = useState<Tab>('people');
  const [sheet, setSheet] = useState<'rename' | 'leave' | { remove: string } | { meetup: MeetupView } | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useTitle(group.data?.name ?? 'Grupo');

  if (group.loading && !group.data) return <Loading />;
  if (group.error && !group.data) {
    return (
      <>
        <PageHead title="Grupo" back={`/conversas/${conversationId}`} />
        {group.error.code === 'NOT_FOUND' ? (
          <EmptyState title="Grupo não encontrado">Só quem está no grupo vê os detalhes. Você entra no grupo ao aceitar o convite do encontro.</EmptyState>
        ) : (
          <ErrorState message={group.error.message} onRetry={group.reload} />
        )}
      </>
    );
  }
  const data = group.data!;
  const isOwner = data.ownerId === me.id;

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
    { id: 'people', label: 'Pessoas' },
    { id: 'events', label: 'Eventos' },
    { id: 'media', label: 'Mídia' },
    { id: 'links', label: 'Links' },
  ];

  return (
    <>
      <PageHead title={data.name} back={`/conversas/${conversationId}`} subtitle={peopleLabel(data.members.length)} />
      <div className="grouphead">
        <GroupAvatar name={data.name} size={96} imageUrl={data.imageUrl} />
      </div>
      <div className="groupmanage">
        {isOwner ? (
          <>
            <Button small variant="secondary" onClick={() => { setName(data.name); setProblem(undefined); setSheet('rename'); }}>
              Mudar nome
            </Button>
            <span className="btn btn--secondary btn--small filebtn">
              Trocar foto
              <input ref={fileRef} type="file" accept="image/*" aria-label="Trocar foto do grupo" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            </span>
            {data.imageUrl ? (
              <Button small variant="quiet" onClick={() => void act(() => api.setGroupPhoto(conversationId, null))}>
                Remover foto
              </Button>
            ) : null}
          </>
        ) : null}
        <Button small variant="quiet" onClick={() => { setProblem(undefined); setSheet('leave'); }}>
          Sair do grupo
        </Button>
      </div>
      {problem && !sheet ? <p className="sugcard__problem" role="alert">{problem}</p> : null}
      <div className="segtabs segtabs--fill" role="tablist" aria-label="Detalhes do grupo">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'people' ? (
        <>
          <h2 className="results__h">Participantes</h2>
          <ul className="list">
            {data.members.map((m) => (
              <PersonRow key={m.profile.userId} profile={m.profile} realName aside={
                  m.role === 'OWNER' ? (
                    <span className="tag tag--event">Criou o grupo</span>
                  ) : isOwner ? (
                    <Button small variant="quiet" onClick={() => { setProblem(undefined); setSheet({ remove: m.profile.userId }); }}>
                      Remover
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
          <p className="muted">Entra no grupo quem aceita o convite do encontro.</p>
        </>
      ) : null}

      {tab === 'events' ? (
        data.meetups.length === 0 ? (
          <EmptyState title="Nenhum evento no grupo">Os encontros marcados com este grupo aparecem aqui.</EmptyState>
        ) : (
          <ul className="groupevents">
            {data.meetups.map((m) => (
              <GroupEvent key={m.id} meetup={m} onManage={m.canManage ? () => { setProblem(undefined); setSheet({ meetup: m }); } : undefined} />
            ))}
          </ul>
        )
      ) : null}

      {tab === 'media' || tab === 'links' ? (
        shared.data ? (
          tab === 'media' ? <SharedMedia voice={shared.data.voice} conversationId={conversationId} /> : <SharedLinks links={shared.data.links} />
        ) : shared.error ? (
          <ErrorState message={shared.error.message} onRetry={shared.reload} />
        ) : (
          <Loading />
        )
      ) : null}

      {sheet === 'rename' ? (
        <Sheet title="Mudar nome do grupo" onClose={() => setSheet(undefined)}>
          <Field label="Nome do grupo" value={name} onChange={setName} maxLength={60} />
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full loading={busy} disabled={name.trim() === '' || name.trim() === data.name} onClick={() => void act(() => api.renameGroup(conversationId, name.trim()))}>
            Salvar nome
          </Button>
        </Sheet>
      ) : null}

      {sheet === 'leave' ? (
        <Sheet title="Sair do grupo" onClose={() => setSheet(undefined)}>
          <p className="muted">
            Você deixa de ver as mensagens do grupo e sai dos encontros dele.{isOwner && data.members.length > 1 ? ' Outra pessoa passa a administrar o grupo.' : ''} Para voltar, só com um novo convite.
          </p>
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full variant="danger" loading={busy} onClick={() => void act(() => api.leaveGroup(conversationId), () => navigate('/conversas'))}>
            Sair do grupo
          </Button>
        </Sheet>
      ) : null}

      {sheet && typeof sheet === 'object' && 'remove' in sheet ? (
        <Sheet title="Remover do grupo" onClose={() => setSheet(undefined)}>
          <p className="muted">{data.members.find((m) => m.profile.userId === sheet.remove)?.profile.displayName ?? 'Essa pessoa'} sai do grupo e dos encontros dele.</p>
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full variant="danger" loading={busy} onClick={() => void act(() => api.removeMember(conversationId, sheet.remove))}>
            Remover
          </Button>
        </Sheet>
      ) : null}

      {sheet && typeof sheet === 'object' && 'meetup' in sheet ? (
        <ManageMeetupSheet meetup={sheet.meetup} excludeIds={data.members.map((m) => m.profile.userId)} onClose={() => setSheet(undefined)} onChanged={() => group.reload()} />
      ) : null}
    </>
  );
}
