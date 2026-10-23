import { ChevronLeftIcon } from '../components/icons.tsx';
import { useTitle } from '../hooks.ts';
import { buildPrivacy, buildTerms, LEGAL_REVIEWED, LEGAL_UPDATED, privacyEmail } from '../lib/legal-text.ts';
import { Link, navigate } from '../router.tsx';

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate('/');
}

/** Política de Privacidade e Termos de Uso. Páginas públicas: abrem com ou sem login. */
export function LegalScreen({ doc }: { doc: 'privacy' | 'terms' }) {
  const email = privacyEmail(import.meta.env.VITE_PRIVACY_EMAIL as string | undefined);
  const content = doc === 'privacy' ? buildPrivacy(email) : buildTerms(email);
  useTitle(content.title);
  return (
    <div className="legal">
      <header className="legal__top">
        <button type="button" className="legal__back" onClick={goBack} aria-label="Voltar">
          <ChevronLeftIcon />
        </button>
        <span className="legal__brand">AskouT</span>
      </header>
      <main className="legal__body">
        <h1>{content.title}</h1>
        <p className="legal__meta">Atualizada em {LEGAL_UPDATED}</p>
        {LEGAL_REVIEWED ? null : (
          <p className="legal__draft" role="note">
            Versão preliminar, ainda em revisão jurídica. Pode mudar antes do lançamento.
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
          {doc === 'privacy' ? <Link to="/termos-de-uso">Ler os Termos de Uso</Link> : <Link to="/politica-de-privacidade">Ler a Política de Privacidade</Link>}
        </p>
      </main>
    </div>
  );
}
