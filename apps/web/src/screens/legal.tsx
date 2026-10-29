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
        </section>
        <p className="legal__switch">
          <Link to="/politica-de-privacidade">{t('Política de Privacidade')}</Link> · <Link to="/termos-de-uso">{t('Termos de Uso')}</Link>
        </p>
      </main>
    </div>
  );
}
