import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { markHidden, readHiddenAt, shouldShowSuggestions, suggestionReasonText } from '../lib/suggested-people.ts';
import { Link } from '../router.tsx';
import { Avatar, Button } from './ui.tsx';
import { ConnectContactsCard, useContactsConnected } from './connect-contacts.tsx';
import { t } from '../lib/i18n/index.ts';

/** "Pessoas que você talvez conheça": amigos em comum, rolês, quem já segue você e gostos parecidos, em carrossel. Aparece sempre que há sugestões; "Ocultar" esconde por 3 dias. */
export function SuggestedPeople() {
  const data = useAsync(() => api.suggestedPeople(), []);
  const [hidden, setHidden] = useState(() => !shouldShowSuggestions(readHiddenAt(), Date.now()));
  const connected = useContactsConnected();
  const items = data.data?.items ?? [];
  // Seguir direto do cartão, sem abrir o perfil. O cartão fica (com "Seguindo" ou "Solicitado") e um toque desfaz.
  const [followed, setFollowed] = useState<Record<string, 'PENDING' | 'ACCEPTED'>>({});
  const [busy, setBusy] = useState<string | undefined>();
  async function toggleFollow(userId: string) {
    setBusy(userId);
    try {
      if (followed[userId]) {
        await api.unfollow(userId);
        setFollowed(({ [userId]: _, ...rest }) => rest);
      } else {
        const { status } = await api.follow(userId);
        setFollowed((c) => ({ ...c, [userId]: status }));
      }
    } catch {
      // Falhou: o botão volta como estava, e dá para tentar de novo.
    } finally {
      setBusy(undefined);
    }
  }
  const show = !hidden && items.length > 0;
  function hide() {
    markHidden(Date.now());
    setHidden(true);
  }
  if (!show) return null;
  return (
    <section className="section suggest enter" aria-labelledby="talvez-titulo">
      <div className="section__head">
        <h2 id="talvez-titulo" className="section__title">
          {t('Pessoas que você talvez conheça')}
        </h2>
        {connected ? <Link to="/amigos/contatos" className="suggest__contacts">{t('Achar nos contatos')}</Link> : null}
        <button type="button" className="linkbtn suggest__hide" onClick={hide}>
          {t('Ocultar')}
        </button>
      </div>
      <ConnectContactsCard />
      <ul className="suggest__track">
        {items.map((p) => (
          <li key={p.userId} className="suggest__card">
            <Link to={`/u/${encodeURIComponent(p.username)}`} className="suggest__link">
              <Avatar profile={p} size={72} />
              <span className="suggest__name">{p.username}</span>
              <span className="suggest__mutual">{suggestionReasonText(p)}</span>
            </Link>
            <Button
              small
              full
              variant={followed[p.userId] ? 'secondary' : 'primary'}
              loading={busy === p.userId}
              disabled={busy !== undefined && busy !== p.userId}
              aria-pressed={followed[p.userId] !== undefined}
              aria-label={followed[p.userId] ? t('Deixar de seguir {name}', { name: p.username }) : t('Seguir {name}', { name: p.username })}
              onClick={() => void toggleFollow(p.userId)}
            >
              {followed[p.userId] === 'PENDING' ? t('Solicitado') : followed[p.userId] ? t('Seguindo') : p.followsYou ? t('Seguir de volta') : t('Seguir')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
