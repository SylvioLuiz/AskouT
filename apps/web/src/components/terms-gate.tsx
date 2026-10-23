import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuthContext } from '../auth.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { Link } from '../router.tsx';
import { Button, Notice } from './ui.tsx';

/**
 * Quando os Termos mudam, quem já tem conta precisa aceitar a versão nova antes de continuar.
 * Enquanto a situação não chega, o app abre normalmente; se a consulta falhar, também (o aceite é registrado pela API, não depende desta tela).
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const status = useAsync(() => api.termsStatus(), []);
  const [accepted, setAccepted] = useState(false);
  if (accepted || !status.data || status.data.upToDate) return <>{children}</>;
  return <TermsNotice version={status.data.currentVersion} first={status.data.acceptedVersion === null} onAccepted={() => setAccepted(true)} />;
}

function TermsNotice({ version, first, onAccepted }: { version: string; first: boolean; onAccepted: () => void }) {
  const { signOut } = useAuthContext();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    if (!checked) {
      setError('Marque a caixa para continuar');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.acceptTerms(version);
      onAccepted();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="termsgate" aria-labelledby="termsgate-title">
      <form className="termsgate__card" onSubmit={(event) => void accept(event)} noValidate>
        <h1 id="termsgate-title">{first ? 'Aceite os Termos para continuar' : 'Os Termos de Uso mudaram'}</h1>
        <p>
          {first
            ? 'Sua conta é anterior ao registro do aceite. Leia os Termos e a Política de Privacidade e confirme para seguir usando o AskouT.'
            : 'Atualizamos os Termos de Uso e a Política de Privacidade. Leia e confirme para seguir usando o AskouT.'}
        </p>
        <p>
          <Link to="/termos-de-uso">Termos de Uso</Link> · <Link to="/politica-de-privacidade">Política de Privacidade</Link>
        </p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <label className="consent">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
        </label>
        <Button type="submit" full loading={busy}>
          Aceitar e continuar
        </Button>
        <button type="button" className="linkbtn" onClick={signOut}>
          Sair
        </button>
      </form>
    </main>
  );
}
