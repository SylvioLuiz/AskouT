import { ChevronLeftIcon } from '../components/icons.tsx';
import { useTitle } from '../hooks.ts';
import { buildLegal, LEGAL_REVIEWED, LEGAL_UPDATED, privacyEmail } from '../lib/legal-text.ts';
import { Link, navigate } from '../router.tsx';
import { getLocale, t } from '../lib/i18n/index.ts';

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate('/');
}

/** Política de Privacidade e Termos de Uso. Páginas públicas: abrem com ou sem login. */
export function LegalScreen({ doc }: { doc: 'privacy' | 'terms' }) {
  const email = privacyEmail(import.meta.env.VITE_PRIVACY_EMAIL as string | undefined);
  const content = buildLegal(doc, email, getLocale());
  useTitle(content.title);
  return (
    <div className="legal">
      <header className="legal__top">
        <button type="button" className="legal__back" onClick={goBack} aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </button>
        <span className="legal__brand">{t('AskouT')}</span>
      </header>
      <main className="legal__body">
        <h1>{content.title}</h1>
        <p className="legal__meta">{t('Atualizada em {data}', { data: content.updated ?? LEGAL_UPDATED })}</p>
        {content.notice ? <p className="legal__draft" role="note">{content.notice}</p> : null}
        {LEGAL_REVIEWED ? null : (
          <p className="legal__draft" role="note">
            {t('Versão preliminar, ainda em revisão jurídica. Pode mudar antes do lançamento.')}
          </p>
        )}
        <p>{content.intro}</p>
        {content.blocks.map((b) => (
          <section key={b.title} className="legal__section">
            <h2>{b.title}</h2>
            {b.text?.map((t) => <p key={t}>{t}</p>)}
            {b.items ? (
              <ul>
                {b.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <p className="legal__switch">
          {doc === 'privacy' ? <Link to="/termos-de-uso">{t('Ler os Termos de Uso')}</Link> : <Link to="/politica-de-privacidade">{t('Ler a Política de Privacidade')}</Link>}
        </p>
      </main>
    </div>
  );
}

/** Página pública de suporte (URL de suporte da App Store): contato e atalhos para o que mais se pergunta. */
export function SupportScreen() {
  const email = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) || 'suporte@askout.com.br';
  useTitle(t('Suporte'));
  return (
    <div className="legal">
      <header className="legal__top">
        <button type="button" className="legal__back" onClick={goBack} aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </button>
        <span className="legal__brand">{t('AskouT')}</span>
      </header>
      <main className="legal__body">
        <h1>{t('Suporte')}</h1>
        <p>{t('Precisa de ajuda com o AskouT? Escreva para a gente e respondemos por e-mail.')}</p>
        <section className="legal__section">
          <h2>{t('Fale com o suporte')}</h2>
          <p><a href={`mailto:${email}`}>{email}</a></p>
        </section>
        <section className="legal__section">
          <h2>{t('Sua conta e seus dados')}</h2>
          <p>{t('Dentro do app, em Perfil > Privacidade, você baixa seus dados e apaga a conta quando quiser.')}</p>
          <p><Link to="/excluir-conta">{t('Como apagar a sua conta')}</Link></p>
        </section>
        <p className="legal__switch">
          <Link to="/politica-de-privacidade">{t('Política de Privacidade')}</Link> · <Link to="/termos-de-uso">{t('Termos de Uso')}</Link>
        </p>
      </main>
    </div>
  );
}

/**
 * Página pública "Como apagar a sua conta" (link de exclusão de conta exigido pelo Google Play).
 * Abre sem login: explica o caminho dentro do app e como pedir por e-mail sem o app instalado.
 */
export function AccountDeletionInfoScreen() {
  const email = privacyEmail(import.meta.env.VITE_PRIVACY_EMAIL as string | undefined);
  useTitle(t('Apagar a sua conta do AskouT'));
  return (
    <div className="legal">
      <header className="legal__top">
        <button type="button" className="legal__back" onClick={goBack} aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </button>
        <span className="legal__brand">{t('AskouT')}</span>
      </header>
      <main className="legal__body">
        <h1>{t('Apagar a sua conta do AskouT')}</h1>
        <p>{t('Você pode apagar a sua conta do AskouT quando quiser, pelo app ou pelo site, ou pedir por e-mail se não tiver mais o app.')}</p>
        <section className="legal__section">
          <h2>{t('Pelo app ou pelo site')}</h2>
          <ol>
            <li>{t('Entre na sua conta.')}</li>
            <li>{t('Abra o seu Perfil, toque no botão de menu (três pontinhos) e escolha Privacidade.')}</li>
            <li>{t('Toque em Apagar minha conta.')}</li>
            <li>{t('Digite o seu @usuário e a sua senha para confirmar. Quem entra com Google ou Apple não precisa de senha.')}</li>
          </ol>
          <p>{t('A conta é apagada na hora. Antes, se quiser, baixe uma cópia dos seus dados na mesma tela de Privacidade.')}</p>
        </section>
        <section className="legal__section">
          <h2>{t('Sem o app')}</h2>
          <p>
            {t('Mande um e-mail para')} <a href={`mailto:${email}?subject=${encodeURIComponent(t('Apagar minha conta do AskouT'))}`}>{email}</a>{' '}
            {t('a partir do e-mail cadastrado na conta, com o seu @usuário. Para proteger a conta, podemos pedir uma confirmação. Respondemos em até 15 dias.')}
          </p>
        </section>
        <section className="legal__section">
          <h2>{t('O que é apagado')}</h2>
          <ul>
            <li>{t('Perfil, foto, posts, comentários, curtidas, stories, eventos criados e presença em eventos.')}</li>
            <li>{t('Mensagens, encontros que você organizou, agenda, NOW, avisos, região e histórico de uso.')}</li>
            <li>{t('Quem você segue e quem segue você. O seu e-mail e o seu @usuário ficam livres de novo.')}</li>
          </ul>
        </section>
        <section className="legal__section">
          <h2>{t('O que pode ficar por um tempo')}</h2>
          <ul>
            <li>{t('Locais que você administra continuam no AskouT, sem dono.')}</li>
            <li>{t('Registros de pagamento podem ser guardados pelo prazo que a lei exige.')}</li>
            <li>{t('Cópias de segurança do banco de dados são substituídas com o tempo; nelas os dados somem quando a cópia é trocada.')}</li>
          </ul>
        </section>
        <p className="legal__switch">
          <Link to="/politica-de-privacidade">{t('Política de Privacidade')}</Link> · <Link to="/suporte">{t('Suporte')}</Link>
        </p>
      </main>
    </div>
  );
}
