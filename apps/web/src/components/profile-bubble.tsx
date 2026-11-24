import { LockIcon, UsersIcon } from './icons.tsx';
import { Avatar } from './ui.tsx';
import { Link } from '../router.tsx';
import type { SharedProfileCard } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/**
 * Perfil compartilhado na conversa. O servidor já aplicou as regras para quem vê:
 * - indisponível (bloqueio ou conta suspensa): nada da pessoa, nem link;
 * - privado que você não segue: só foto, nome e @, com o aviso "Perfil privado" (o mesmo que a página do perfil mostra).
 */
export function ProfileBubble({ card }: { card: SharedProfileCard }) {
  const p = card.profile;
  if (!p) {
    return (
      <div className="pfbubble pfbubble--gone" role="note">
        <span className="pfbubble__ghost" aria-hidden="true">
          <UsersIcon />
        </span>
        <span className="pfbubble__who">
          <strong className="pfbubble__name">{t('Perfil indisponível')}</strong>
          <span className="pfbubble__sub">{t('Este perfil não pode ser visto.')}</span>
        </span>
      </div>
    );
  }
  const locked = p.isPrivate && !card.canView;
  const cta = card.following === 'SELF' ? t('Ver meu perfil') : locked ? (card.following === 'PENDING' ? t('Solicitado') : t('Ver perfil')) : t('Ver perfil');
  return (
    <Link to={`/u/${encodeURIComponent(p.username)}`} className="pfbubble" aria-label={t('Abrir o perfil de {name}', { name: p.displayName })}>
      <span className="pfbubble__top">
        <Avatar profile={p} size={48} />
        <span className="pfbubble__who">
          <strong className="pfbubble__name">{p.displayName}</strong>
          <span className="pfbubble__sub">
            @{p.username}
            {p.isPrivate ? (
              <span className="pfbubble__lock" title={t('Perfil privado')}>
                <LockIcon />
              </span>
            ) : null}
          </span>
          {locked ? <span className="pfbubble__sub">{t('Perfil privado')}</span> : null}
        </span>
      </span>
      <span className="pfbubble__cta">{cta}</span>
    </Link>
  );
}
