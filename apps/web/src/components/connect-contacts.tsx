import { useState } from 'react';
import { UserPlusIcon } from './icons.tsx';
import { contactsConnected } from '../lib/contacts-prompt.ts';
import { safeStorage } from '../lib/hints.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** "Conecte seus contatos": aparece no topo das sugestões e da tela Amigos até a pessoa conferir a agenda uma vez. */
export function ConnectContactsCard() {
  const connected = useContactsConnected();
  if (connected) return null;
  return (
    <Link to="/amigos/contatos" className="invitecta connectcta">
      <span className="invitecta__icon" aria-hidden="true">
        <UserPlusIcon />
      </span>
      <span className="invitecta__text">
        <span className="invitecta__title">{t('Conecte seus contatos')}</span>
        <span className="invitecta__sub">{t('Veja quem da sua agenda já está no AskouT.')}</span>
      </span>
    </Link>
  );
}

/** Se a agenda já foi conectada, mostra o link discreto em vez do card. */
export function useContactsConnected(): boolean {
  const [connected] = useState(() => contactsConnected(safeStorage()));
  return connected;
}
