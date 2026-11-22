import { useEffect } from 'react';
import { useAuthContext } from '../auth.tsx';
import { useTitle } from '../hooks.ts';
import { APP_STORE_URL, PLAY_STORE_URL, inviteLandingTarget, invitePlatform, parseInvite } from '../lib/invite.ts';
import { navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

function isNativeApp(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/**
 * `/convite/usuario`, o link que vai no convite (WhatsApp etc.). Com o app instalado, o celular já abre o app nesta rota
 * (Universal Link / intent) e ela leva ao cadastro com o convite. No navegador do celular, manda para a loja;
 * no computador, para o cadastro do site. Os botões ficam na tela caso o redirecionamento não aconteça.
 */
export function InviteLandingScreen({ username }: { username: string }) {
  useTitle(t('Convite para o AskouT'));
  const { state } = useAuthContext();
  const invitedBy = parseInvite(username);
  const native = isNativeApp();
  const loading = native && state.status === 'loading';

  useEffect(() => {
    if (!invitedBy) {
      navigate('/cadastro', { replace: true });
      return;
    }
    if (loading) return;
    const platform = invitePlatform(navigator.userAgent, navigator.maxTouchPoints || 0);
    const target = inviteLandingTarget({ username: invitedBy, native, loggedIn: state.status === 'user', platform });
    if (target.kind === 'route') navigate(target.to, { replace: true });
    else window.location.replace(target.to);
  }, [invitedBy, native, loading, state.status]);

  if (!invitedBy || native) return null;
  return (
    <div className="legal">
      <main className="legal__body">
        <h1>{t('@{username} te chamou para o AskouT', { username: invitedBy })}</h1>
        <p>{t('Baixe o app para entrar. Se você já tem o AskouT, ele abre sozinho.')}</p>
        <div className="stack">
          <a className="btn btn--primary btn--full" href={APP_STORE_URL}>
            {t('Baixar na App Store')}
          </a>
          <a className="btn btn--primary btn--full" href={PLAY_STORE_URL}>
            {t('Baixar no Google Play')}
          </a>
          <a className="btn btn--secondary btn--full" href={`/cadastro?convite=${encodeURIComponent(invitedBy)}`}>
            {t('Continuar no site')}
          </a>
        </div>
      </main>
    </div>
  );
}
