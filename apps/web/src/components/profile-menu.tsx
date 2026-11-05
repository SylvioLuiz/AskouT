import { useState } from 'react';
import { ChevronRightIcon, UsersIcon } from './icons.tsx';
import { InviteSheet } from './invite.tsx';
import { Sheet } from './agenda.tsx';
import { useAuthContext } from '../auth.tsx';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

export const PROFILE_MENU: { to: string; label: string }[] = [
  { to: '/configuracao', label: t('Configuração') },
  { to: '/privacidade', label: t('Privacidade') },
  { to: '/locais', label: t('Meus locais') },
  { to: '/arquivados', label: t('Arquivados') },
  { to: '/interacoes', label: t('Suas interações') },
  { to: '/ajuda', label: t('Ajuda') },
  { to: '/tema', label: t('Tema e idioma') },
];

/** Menu do perfil numa folha que sobe da base da tela, como nos apps nativos. Fecha puxando para baixo, com Esc ou tocando fora. */
export function ProfileMenu({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuthContext();
  const [inviting, setInviting] = useState(false);
  // O convite troca a folha do menu pela do convite (uma folha por vez); fechar o convite fecha tudo.
  if (inviting) return <InviteSheet onClose={onClose} />;
  return (
    <Sheet title={t('Menu do perfil')} onClose={onClose}>
      <button type="button" className="invitecta" onClick={() => setInviting(true)}>
        <span className="invitecta__icon" aria-hidden="true">
          <UsersIcon />
        </span>
        <span className="invitecta__text">
          <span className="invitecta__title">{t('Chame a galera')}</span>
          <span className="invitecta__sub">{t('O AskouT é melhor com os amigos. Compartilhe o link.')}</span>
        </span>
      </button>
      <ul className="menulist">
        {PROFILE_MENU.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="menulist__item" onClick={onClose}>
              <span>{item.label}</span>
              <ChevronRightIcon />
            </Link>
          </li>
        ))}
      </ul>
      <ul className="menulist">
        <li>
          <button type="button" className="menulist__item menulist__item--danger" onClick={signOut}>
            <span>{t('Sair')}</span>
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
