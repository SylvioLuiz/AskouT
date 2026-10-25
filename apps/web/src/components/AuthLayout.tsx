import { useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { t } from '../lib/i18n/index.ts';

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

export function AuthLayout({ children }: { children: ReactNode }) {
  useNightTheme();
  return (
    <div className="auth">
      <section className="auth__hero">
        <img className="auth__scene" src="/auth-hero.jpg" alt={t('AskouT')} width="780" height="540" />
        <h1 className="auth__headline">{t('Menos tempo combinando. Mais tempo juntos.')}</h1>
      </section>
      <section className="auth__panel">{children}</section>
    </div>
  );
}
