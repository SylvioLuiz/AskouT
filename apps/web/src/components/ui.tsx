import { api } from '../client.ts';
import { safeGroupImage } from '../lib/image.ts';
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLInputTypeAttribute, ReactNode } from 'react';
import { initials, tintIndex } from '../lib/avatar.ts';
import type { PublicProfile } from '../lib/types.ts';
import { ChevronLeftIcon } from './icons.tsx';
import { Link } from '../router.tsx';

// ---------- Botões ----------

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  loading?: boolean;
  full?: boolean;
  small?: boolean;
}

export function Button({ variant = 'primary', loading = false, full = false, small = false, disabled, children, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, full ? 'btn--full' : '', small ? 'btn--small' : ''].filter(Boolean).join(' ');
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {children}
    </button>
  );
}

// ---------- Campos de formulário ----------

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: HTMLInputTypeAttribute;
  error?: string | undefined;
  hint?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'email';
  prefix?: string;
  maxLength?: number;
  autoFocus?: boolean;
  multiline?: boolean;
  trailing?: ReactNode;
  name?: string;
  placeholder?: string;
  /** O rótulo continua para leitores de tela, mas não aparece. */
  hideLabel?: boolean;
}

export function Field({ label, value, onChange, type = 'text', error, hint, autoComplete, inputMode, prefix, maxLength, autoFocus, multiline, trailing, name, placeholder, hideLabel }: FieldProps) {
  const id = useId();
  const messageId = `${id}-msg`;
  const message = error ?? hint;
  const common = {
    id,
    name,
    value,
    maxLength,
    autoFocus,
    autoComplete,
    inputMode,
    placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': message ? messageId : undefined,
    className: 'field__input',
  } as const;

  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className={`field__label${hideLabel ? ' visually-hidden' : ''}`} htmlFor={id}>
        {label}
      </label>
      <div className="field__control">
        {prefix ? <span className="field__prefix">{prefix}</span> : null}
        {multiline ? (
          <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <input {...common} type={type} onChange={(event) => onChange(event.target.value)} />
        )}
        {trailing}
      </div>
      {message ? (
        <p id={messageId} className={error ? 'field__error' : 'field__hint'} role={error ? 'alert' : undefined}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button type="button" className="field__toggle" onClick={() => setVisible((v) => !v)} aria-pressed={visible}>
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      }
    />
  );
}

// ---------- Avisos e estados ----------

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2 className="empty__title">{title}</h2>
      {children ? <p className="empty__text">{children}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ label = 'Carregando' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      {label}…
    </p>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <h2 className="empty__title">Não deu certo</h2>
      <p className="empty__text">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}

// ---------- Pessoas ----------

type AvatarProfile = Pick<PublicProfile, 'username' | 'displayName' | 'avatarUrl'>;

export function Avatar({ profile, size = 44 }: { profile: AvatarProfile; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (profile.avatarUrl) {
    return <img className="avatar avatar--photo" src={profile.avatarUrl.startsWith('/') ? api.assetUrl(profile.avatarUrl) : profile.avatarUrl} alt="" style={style} referrerPolicy="no-referrer" />;
  }
  return (
    <span className={`avatar avatar--tint-${tintIndex(profile.username)}`} style={style} aria-hidden="true">
      {initials(profile.displayName, profile.username)}
    </span>
  );
}

/** Linha de pessoa, usada em buscas e listas. Leva ao perfil. */
export function PersonRow({ profile, aside }: { profile: PublicProfile; aside?: ReactNode }) {
  return (
    <li className="person">
      <Link to={`/u/${encodeURIComponent(profile.username)}`} className="person__link">
        <Avatar profile={profile} />
        <span className="person__body">
          <span className="person__name">{profile.displayName}</span>
          <span className="person__handle">@{profile.username}</span>
        </span>
      </Link>
      {aside ? <div className="person__aside">{aside}</div> : null}
    </li>
  );
}

// ---------- Estrutura de página ----------

export function PageHead({ title, back, subtitle, titleTo }: { title: string; back?: string; subtitle?: string; titleTo?: string }) {
  return (
    <header className="pagehead">
      {back ? (
        <Link to={back} className="pagehead__back" aria-label="Voltar">
          <ChevronLeftIcon />
        </Link>
      ) : null}
      {titleTo ? (
        <Link to={titleTo} className="pagehead__link">
          <h1 className="pagehead__title">{title}</h1>
          {subtitle ? <p className="pagehead__subtitle">{subtitle}</p> : null}
        </Link>
      ) : (
        <div>
          <h1 className="pagehead__title">{title}</h1>
          {subtitle ? <p className="pagehead__subtitle">{subtitle}</p> : null}
        </div>
      )}
    </header>
  );
}

/** Pergunta de confirmação na própria tela, sem janela do navegador. */
export function Confirm({ question, confirmLabel, onConfirm, onCancel, busy, danger }: { question: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <div className="confirm" role="group" aria-label={question}>
      <p className="confirm__question">{question}</p>
      <div className="confirm__actions">
        <Button variant={danger ? 'danger' : 'primary'} small onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
        <Button variant="quiet" small onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Círculo do grupo: a inicial do nome sobre uma cor fixa (ainda não há foto de grupo). */
export function GroupAvatar({ name, size = 44, imageUrl }: { name: string; size?: number; imageUrl?: string | null }) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '#';
  const image = safeGroupImage(imageUrl);
  return (
    <span className="avatar avatar--group" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {image ? <img className="avatar--group__img" src={image} alt="" /> : letter}
    </span>
  );
}
