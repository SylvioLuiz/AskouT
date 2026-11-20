import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { t } from '../lib/i18n/index.ts';
import { Link } from '../router.tsx';
import { ChevronLeftIcon } from './icons.tsx';

/** Entrada e cadastro ficam sempre no visual noturno; ao sair da tela, volta o tema que a pessoa escolheu. */
function useNightTheme(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, []);
}

/** `fit`: no celular a tela cabe inteira, sem rolagem (usado na entrada). */
export function AuthLayout({ children, fit = false }: { children: ReactNode; fit?: boolean }) {
  useNightTheme();
  return (
    <div className={fit ? 'auth auth--fit' : 'auth'}>
      <section className="auth__hero">
        {/* Sem conta dá para ver os rolês da cidade escolhida: a entrada sempre tem caminho de volta para a Home. */}
        <Link to="/" className="auth__home" aria-label={t('Voltar para a Home')}>
          <ChevronLeftIcon />
          <span>{t('Voltar')}</span>
        </Link>
        <img className="auth__scene" src="/auth-hero.jpg" alt={t('AskouT')} width="780" height="540" />
        <h1 className="auth__headline">{t('Menos tempo combinando. Mais tempo juntos.')}</h1>
      </section>
      <section className="auth__panel">{children}</section>
    </div>
  );
}
