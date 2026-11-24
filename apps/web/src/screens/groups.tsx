import { useState } from 'react';
import { api } from '../client.ts';
import { NewConversationSheet } from '../components/new-conversation.tsx';
import { Button, EmptyState, ErrorState, GroupAvatar, Loading, PageHead } from '../components/ui.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import { peopleLabel } from '../lib/meetup.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Grupos de amigos: os convites que você recebeu (aceitar ou recusar), os grupos de que faz parte e o botão
 * para criar um grupo. Quem é convidado só entra quando aceita.
 */
export function GroupsScreen() {
  const search = useSearch();
  const list = useAsync(() => api.communities(), []);
  const [creating, setCreating] = useState(search.get('criar') === '1');
  const [busy, setBusy] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  useTitle(t('Grupos'));

  async function answer(conversationId: string, accept: boolean) {
    setBusy(conversationId);
    setProblem(undefined);
    try {
      if (accept) {
        await api.acceptCommunity(conversationId);
        navigate(`/conversas/${conversationId}/grupo`);
        return;
      }
      await api.declineCommunity(conversationId);
      list.reload();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(undefined);
    }
  }

  const head = <PageHead title={t('Grupos')} back="/conversas" />;
  const create = (
    <Button full onClick={() => setCreating(true)}>
      {t('Criar grupo')}
    </Button>
  );
  const sheet = creating ? <NewConversationSheet group onClose={() => setCreating(false)} /> : null;
  if (list.loading && !list.data) {
    return (
      <>
        {head}
        <Loading />
      </>
    );
  }
  if (list.error && !list.data) {
    return (
      <>
        {head}
        <ErrorState message={list.error.message} onRetry={list.reload} />
      </>
    );
  }
  const { items, invites } = list.data!;
  const now = new Date();

  return (
    <>
      {head}
      <div className="groupscreen__create">{create}</div>
      {problem ? <p className="sugcard__problem" role="alert">{problem}</p> : null}

      {invites.length > 0 ? (
        <>
          <h2 className="results__h groupscreen__h">{t('Convites')}</h2>
          <ul className="grouplist" aria-label={t('Convites para grupos')}>
            {invites.map((invite) => (
              <li key={invite.conversationId} className="grouprow">
                <GroupAvatar name={invite.name} size={48} imageUrl={invite.imageUrl} />
                <span className="grouprow__body">
                  <strong>{invite.name}</strong>
                  <span className="muted">
                    {invite.invitedBy ? t('@{username} convidou você', { username: invite.invitedBy.username }) : t('Você foi convidado(a)')} · {peopleLabel(invite.memberCount)}
                  </span>
                  <span className="grouprow__actions">
                    <Button small loading={busy === invite.conversationId} onClick={() => void answer(invite.conversationId, true)}>
                      {t('Aceitar')}
                    </Button>
                    <Button small variant="secondary" disabled={busy === invite.conversationId} onClick={() => void answer(invite.conversationId, false)}>
                      {t('Recusar')}
                    </Button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2 className="results__h groupscreen__h">{t('Seus grupos')}</h2>
      {items.length === 0 ? (
        <EmptyState title={t('Nenhum grupo ainda')}>
          {t('Crie um grupo com seus amigos: cada um recebe um convite e entra quando aceitar. Dentro do grupo você cria eventos que já chegam para todo mundo.')}
        </EmptyState>
      ) : (
        <ul className="grouplist">
          {items.map((g) => (
            <li key={g.conversationId}>
              <Link to={`/conversas/${g.conversationId}/grupo`} className="grouprow">
                <GroupAvatar name={g.name} size={48} imageUrl={g.imageUrl} />
                <span className="grouprow__body">
                  <strong>{g.name}</strong>
                  <span className="muted">
                    {peopleLabel(g.memberCount)}
                    {g.canManage ? ` · ${t('Você administra')}` : ''}
                  </span>
                  {g.nextEvent ? (
                    <span className="muted">
                      {t('Próximo: {title}', { title: g.nextEvent.title })}
                      {g.nextEvent.startsAt ? ` · ${formatWhen(g.nextEvent.startsAt, g.nextEvent.endsAt, now)}` : ''}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {sheet}
    </>
  );
}
