import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { badgeProgressText, broughtText } from '../lib/referrals.ts';
import { Link } from '../router.tsx';
import { shareOrigin } from '../lib/public-origin.ts';
import { useUser } from '../auth.tsx';
import { inviteText, shareableInviteUrl, storeLink, whatsappUrl } from '../lib/invite.ts';
import { Sheet } from './agenda.tsx';
import { Avatar, Button, Notice } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

/** Convidar quem ainda não está no AskouT: WhatsApp, compartilhar do aparelho ou copiar o link. */
export function InviteSheet({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const store = storeLink(import.meta.env.VITE_STORE_URL as string | undefined);
  const url = shareableInviteUrl(shareOrigin(), user.profile.username, store);
  const text = inviteText(user.profile.displayName);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const referrals = useAsync(() => api.referrals(), []);
  const [hiding, setHiding] = useState(false);

  async function toggleBadge(hidden: boolean) {
    setHiding(true);
    try {
      await api.setReferralBadgeHidden(hidden);
      referrals.reload();
    } catch {
      setMessage({ tone: 'error', text: t('Não foi possível salvar agora. Tente de novo.') });
    } finally {
      setHiding(false);
    }
  }

  async function shareOrCopy() {
    setMessage(undefined);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: t('AskouT'), text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'ok', text: t('Link copiado. Cole onde quiser.') });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: t('Não foi possível copiar. O link é {url}', { url }) });
    }
  }

  return (
    <Sheet title={t('Convidar amigos')} onClose={onClose}>
      <p className="muted">
        {store
          ? t('Mande o link para a galera baixar o app. Depois, é só se seguirem para virarem amigos.')
          : t('Quem entrar pelo seu link já passa a seguir você. Para virarem amigos, é só você seguir de volta.')}
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className="stack">
        <a className="btn btn--primary btn--full" href={whatsappUrl(text, url)} target="_blank" rel="noopener noreferrer">
          {t('Enviar pelo WhatsApp')}
        </a>
        <Button full variant="secondary" onClick={() => void shareOrCopy()}>
          {typeof navigator.share === 'function' ? t('Compartilhar link') : t('Copiar link')}
        </Button>
      </div>
      {referrals.data ? (
        <section className="referrals" aria-label={t('Amigos que você trouxe')}>
          <h3 className="referrals__title">{broughtText(referrals.data.brought)}</h3>
          <p className="muted small">{badgeProgressText(referrals.data)}</p>
          {referrals.data.people.length > 0 ? (
            <ul className="referrals__list">
              {referrals.data.people.map((p) => (
                <li key={p.profile.userId} className="referrals__item">
                  <Link to={`/u/${encodeURIComponent(p.profile.username)}`} className="referrals__link">
                    <Avatar profile={p.profile} size={32} />
                    <span>@{p.profile.username}</span>
                  </Link>
                  {p.confirmed ? <span className="referrals__ok">{t('voltou ao app')}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {referrals.data.badgeEarned ? (
            <label className="referrals__toggle">
              <input type="checkbox" checked={!referrals.data.badgeHidden} disabled={hiding} onChange={(e) => void toggleBadge(!e.target.checked)} />
              <span>{t('Mostrar o selo no meu perfil')}</span>
            </label>
          ) : null}
        </section>
      ) : null}
    </Sheet>
  );
}
