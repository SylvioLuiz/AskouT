import { Field } from './ui.tsx';
import { todayIso } from '../lib/age.ts';
import { Link } from '../router.tsx';

interface Props {
  birth: string;
  onBirth: (value: string) => void;
  accepted: boolean;
  onAccepted: (value: boolean) => void;
  errors: Record<string, string>;
}

/** Data de nascimento e aceite dos Termos, pedidos ao criar a conta. */
export function ConsentFields({ birth, onBirth, accepted, onAccepted, errors }: Props) {
  return (
    <>
      <Field label="Data de nascimento" type="date" value={birth} onChange={onBirth} error={errors['birthDate']} hint="Não aparece para ninguém. Você pode corrigir depois em Editar perfil." max={todayIso()} autoComplete="bday" />
      <div className={`consent${errors['acceptTerms'] ? ' consent--error' : ''}`}>
        <label className="consent__row">
          <input type="checkbox" checked={accepted} onChange={(e) => onAccepted(e.target.checked)} aria-invalid={errors['acceptTerms'] ? true : undefined} aria-describedby={errors['acceptTerms'] ? 'consent-msg' : undefined} />
          <span>
            Li e aceito os <Link to="/termos-de-uso">Termos de Uso</Link> e a <Link to="/politica-de-privacidade">Política de Privacidade</Link>.
          </span>
        </label>
        {errors['acceptTerms'] ? (
          <p id="consent-msg" className="consent__msg" role="alert">
            {errors['acceptTerms']}
          </p>
        ) : null}
      </div>
    </>
  );
}
