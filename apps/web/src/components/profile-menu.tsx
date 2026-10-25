import { useEffect, useRef } from 'react';
import { XIcon } from './icons.tsx';
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

/** Painel escuro que abre pela direita com o menu do perfil. */
export function ProfileMenu({ onClose }: { onClose: () => void }) {
  const { signOut } = useAuthContext();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button');
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="drawer" onMouseDown={(event) => event.target === event.currentTarget && closeRef.current()}>
      <nav className="drawer__panel" role="dialog" aria-modal="true" aria-label={t('Menu do perfil')} ref={panelRef}>
        <button type="button" className="drawer__close" onClick={() => closeRef.current()} aria-label={t('Fechar menu')}>
          <XIcon />
        </button>
        <ul className="drawer__list">
          {PROFILE_MENU.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className="drawer__item" onClick={() => closeRef.current()}>
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="drawer__item drawer__item--out" onClick={signOut}>
              {t('Sair')}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
