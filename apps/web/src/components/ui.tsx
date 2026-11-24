import { api } from '../client.ts';
import { groupPhotoSrc } from '../lib/image.ts';
import { useCallback, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLInputTypeAttribute, MouseEvent, ReactNode } from 'react';
import { initials, tintIndex } from '../lib/avatar.ts';
import type { PublicProfile } from '../lib/types.ts';
import { BoltIcon, ChevronLeftIcon } from './icons.tsx';
import { useFlashOn } from './flash-presence.tsx';
import { useOnline } from './online-presence.tsx';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

// ---------- Botões ----------

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'onClick'> {
  variant?: Variant;
  loading?: boolean;
  full?: boolean;
  small?: boolean;
  /** Se devolver uma promessa, o botão fica travado e girando até ela terminar. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown;
}

/**
 * Botão padrão. Nunca dispara a ação duas vezes: se o onClick devolver uma promessa,
 * o botão trava e mostra um spinner até ela acabar; cliques no meio do caminho são ignorados.
 */
export function Button({ variant = 'primary', loading = false, full = false, small = false, disabled, children, type = 'button', onClick, ...rest }: ButtonProps) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const busy = loading || pending;
  const classes = ['btn', `btn--${variant}`, full ? 'btn--full' : '', small ? 'btn--small' : ''].filter(Boolean).join(' ');
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (running.current || busy) {
      event.preventDefault();
      return;
    }
    const result = onClick?.(event);
    if (isThenable(result)) {
      running.current = true;
      setPending(true);
      const done = () => {
        running.current = false;
        setPending(false);
      };
      result.then(done, done);
    }
  }
  return (
    <button {...rest} type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick ? handleClick : undefined}>
      {children}
    </button>
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

/**
 * Para botões soltos (sem o <Button>): embrulha uma ação assíncrona para ela nunca rodar
 * duas vezes ao mesmo tempo. Devolve a ação protegida e se ela está rodando.
 */
export function useOnce<A extends unknown[]>(action: (...args: A) => Promise<unknown> | unknown): [(...args: A) => void, boolean] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const latest = useRef(action);
  latest.current = action;
  const run = useCallback((...args: A) => {
    if (running.current) return;
    const result = latest.current(...args);
    if (!isThenable(result)) return;
    running.current = true;
    setBusy(true);
    const done = () => {
      running.current = false;
      setBusy(false);
    };
    result.then(done, done);
  }, []);
  return [run, busy];
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
  inputMode?: 'text' | 'numeric' | 'email' | 'url' | 'tel';
  prefix?: string;
  maxLength?: number;
  autoFocus?: boolean;
  multiline?: boolean;
  trailing?: ReactNode;
  name?: string;
  placeholder?: string;
  /** O rótulo continua para leitores de tela, mas não aparece. */
  hideLabel?: boolean;
  min?: string;
  max?: string;
}

export function Field({ label, value, onChange, type = 'text', error, hint, autoComplete, inputMode, prefix, maxLength, autoFocus, multiline, trailing, name, placeholder, hideLabel, min, max }: FieldProps) {
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
    min,
    max,
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
          {visible ? t('Ocultar') : t('Mostrar')}
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

/**
 * Formato do esqueleto, imitando o que vai aparecer:
 * list (pessoas, avisos, conversas), posts (cartões do feed), grid (fotos 3 por linha), tiles (eventos e locais com
 * capa, 2 por linha), page (página de detalhe: capa, título, texto e botões), profile (cabeçalho de perfil),
 * carousel (cartões lado a lado), lines (ajustes e textos), block (um quadro só: mapa, QR, recorte),
 * inline (uma linha curta, para "calculando" dentro de um cartão), rows (linhas com miniatura quadrada: álbuns),
 * form (campos com rótulo e um botão), toggles (ajustes com chave liga/desliga), cards (cartões empilhados com
 * título, texto e botões) panel (painel do local: cartão do local, três números e a pilha de botões), stories (flashes em pé, 3 por linha) e feed
 * (posts do mural de um local ou evento: cartões com borda, autor, texto e foto).
 */
export type LoadingShape = 'list' | 'posts' | 'grid' | 'tiles' | 'page' | 'profile' | 'carousel' | 'lines' | 'block' | 'inline' | 'rows' | 'form' | 'toggles' | 'cards' | 'panel' | 'stories' | 'feed';

const Bone = ({ className }: { className: string }) => <span className={`skeleton__bone ${className}`} />;
const times = (n: number) => Array.from({ length: n }, (_, i) => i);

function ListRows({ rows, square = false }: { rows: number; square?: boolean }) {
  return (
    <>
      {times(rows).map((i) => (
        <div key={i} className="skeleton__row">
          <span className={`skeleton__avatar${square ? ' skeleton__avatar--square' : ''}`} />
          <span className="skeleton__lines">
            <span className={`skeleton__line ${i % 2 === 0 ? 'skeleton__line--wide' : 'skeleton__line--mid'}`} />
            <span className="skeleton__line" />
          </span>
        </div>
      ))}
    </>
  );
}

function SkeletonBody({ shape, rows }: { shape: LoadingShape; rows: number | undefined }) {
  switch (shape) {
    case 'posts':
      return (
        <>
          {times(rows ?? 2).map((i) => (
            <div key={i} className="skeleton__post">
              <ListRows rows={1} />
              <Bone className="skeleton__media" />
              <span className="skeleton__line skeleton__line--wide" />
              <span className="skeleton__line" />
            </div>
          ))}
        </>
      );
    case 'grid':
      return (
        <div className="skeleton__grid">
          {times(rows ?? 9).map((i) => (
            <Bone key={i} className="skeleton__square" />
          ))}
        </div>
      );
    case 'tiles':
      return (
        <div className="skeleton__tiles">
          {times(rows ?? 4).map((i) => (
            <div key={i} className="skeleton__tile">
              <Bone className="skeleton__cover" />
              <span className="skeleton__line skeleton__line--wide" />
              <span className="skeleton__line" />
              <span className="skeleton__line skeleton__line--short" />
            </div>
          ))}
        </div>
      );
    case 'page':
      return (
        <>
          <Bone className="skeleton__hero" />
          <span className="skeleton__line skeleton__line--title" />
          <span className="skeleton__line skeleton__line--mid" />
          <div className="skeleton__buttons">
            <Bone className="skeleton__button" />
            <Bone className="skeleton__button" />
          </div>
          <span className="skeleton__line skeleton__line--wide" />
          <span className="skeleton__line skeleton__line--wide" />
          <span className="skeleton__line" />
        </>
      );
    case 'profile':
      return (
        <>
          <div className="skeleton__head">
            <span className="skeleton__avatar skeleton__avatar--big" />
            <span className="skeleton__line skeleton__line--title" />
            <span className="skeleton__line" />
          </div>
          <div className="skeleton__stats">
            {times(3).map((i) => (
              <Bone key={i} className="skeleton__stat" />
            ))}
          </div>
          <div className="skeleton__grid">
            {times(6).map((i) => (
              <Bone key={i} className="skeleton__square" />
            ))}
          </div>
        </>
      );
    case 'carousel':
      return (
        <div className="skeleton__carousel">
          {times(rows ?? 3).map((i) => (
            <div key={i} className="skeleton__slide">
              <Bone className="skeleton__cover" />
              <span className="skeleton__line skeleton__line--wide" />
              <span className="skeleton__line" />
              <Bone className="skeleton__button" />
            </div>
          ))}
        </div>
      );
    case 'lines':
      return (
        <>
          {times(rows ?? 3).map((i) => (
            <div key={i} className="skeleton__setting">
              <span className="skeleton__line skeleton__line--mid" />
              <span className="skeleton__line skeleton__line--wide" />
            </div>
          ))}
        </>
      );
    case 'rows':
      return <ListRows rows={rows ?? 4} square />;
    case 'form':
      return (
        <>
          {times(rows ?? 3).map((i) => (
            <div key={i} className="skeleton__field">
              <span className="skeleton__line skeleton__line--label" />
              <Bone className="skeleton__input" />
            </div>
          ))}
          <Bone className="skeleton__wide" />
        </>
      );
    case 'toggles':
      return (
        <div className="skeleton__toggles">
          {times(rows ?? 4).map((i) => (
            <div key={i} className="skeleton__toggle">
              <span className="skeleton__lines">
                <span className="skeleton__line skeleton__line--label" />
                <span className={`skeleton__line ${i % 2 === 0 ? 'skeleton__line--wide' : 'skeleton__line--mid'}`} />
              </span>
              <Bone className="skeleton__switch" />
            </div>
          ))}
        </div>
      );
    case 'cards':
      return (
        <>
          {times(rows ?? 3).map((i) => (
            <div key={i} className="skeleton__card">
              <span className="skeleton__line skeleton__line--mid skeleton__line--strong" />
              <span className="skeleton__line skeleton__line--wide" />
              <span className="skeleton__line" />
              <div className="skeleton__buttons">
                <Bone className="skeleton__button skeleton__button--small" />
                <Bone className="skeleton__button skeleton__button--small" />
              </div>
            </div>
          ))}
        </>
      );
    case 'panel':
      return (
        <>
          <Bone className="skeleton__wide skeleton__wide--tabs" />
          <div className="skeleton__card skeleton__card--row">
            <span className="skeleton__avatar" />
            <span className="skeleton__lines">
              <span className="skeleton__line skeleton__line--mid skeleton__line--strong" />
              <span className="skeleton__line" />
            </span>
          </div>
          <div className="skeleton__stats">
            {times(3).map((i) => (
              <Bone key={i} className="skeleton__stat skeleton__stat--tall" />
            ))}
          </div>
          {times(rows ?? 5).map((i) => (
            <Bone key={i} className="skeleton__wide" />
          ))}
        </>
      );
    case 'feed':
      return (
        <>
          {times(rows ?? 2).map((i) => (
            <div key={i} className="skeleton__card skeleton__card--feed">
              <ListRows rows={1} />
              <span className="skeleton__line skeleton__line--wide" />
              <Bone className="skeleton__feedmedia" />
            </div>
          ))}
        </>
      );
    case 'stories':
      return (
        <div className="skeleton__grid skeleton__grid--stories">
          {times(rows ?? 3).map((i) => (
            <Bone key={i} className="skeleton__story" />
          ))}
        </div>
      );
    case 'block':
      return <Bone className="skeleton__block" />;
    case 'inline':
      return <span className="skeleton__line skeleton__line--mid" />;
    default:
      return <ListRows rows={rows ?? 4} />;
  }
}

/** Enquanto carrega, mostra a forma da tela (no formato `shape`) em vez de só uma palavra. */
export function Loading({ label = 'Carregando', shape = 'list', rows }: { label?: string; shape?: LoadingShape; rows?: number }) {
  return (
    <div className={`loading loading--${shape}`} role="status" aria-live="polite">
      <span className="visually-hidden">{label}…</span>
      <div className={`skeleton skeleton--${shape}`} aria-hidden="true">
        <SkeletonBody shape={shape} rows={rows} />
      </div>
    </div>
  );
}

/**
 * Cabeçalho de página enquanto os dados chegam: o mesmo `.pagehead` da tela pronta, com o título real quando ele já é
 * conhecido (ou uma barra no lugar) e uma barra no lugar do subtítulo que depende dos dados, para nada pular depois.
 */
export function PageHeadSkeleton({ title, back, subtitle = false }: { title?: string; back?: string; subtitle?: boolean }) {
  return (
    <header className="pagehead">
      {back ? (
        <Link to={back} className="pagehead__back" aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </Link>
      ) : null}
      <div className="pagehead__skel">
        {title ? <h1 className="pagehead__title">{title}</h1> : <span className="skeleton__line skeleton__line--head" aria-hidden="true" />}
        {subtitle ? <span className="skeleton__line skeleton__line--sub" aria-hidden="true" /> : null}
      </div>
    </header>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <h2 className="empty__title">{t('Não deu certo')}</h2>
      <p className="empty__text">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t('Tentar de novo')}
        </Button>
      ) : null}
    </div>
  );
}

// ---------- Pessoas ----------

type AvatarProfile = Pick<PublicProfile, 'username' | 'displayName' | 'avatarUrl'> & { userId?: string };

/** Foto (ou iniciais) da pessoa. Com o Flash ligado, ganha um pequeno raio no canto inferior esquerdo, em qualquer tela. */
export function Avatar({ profile, size = 44 }: { profile: AvatarProfile; size?: number }) {
  const flashOn = useFlashOn(profile.userId);
  const online = useOnline(profile.userId);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  const face = profile.avatarUrl ? (
    <img className="avatar avatar--photo" src={profile.avatarUrl.startsWith('/') ? api.assetUrl(profile.avatarUrl) : profile.avatarUrl} alt="" style={style} referrerPolicy="no-referrer" />
  ) : (
    <span className={`avatar avatar--tint-${tintIndex(profile.username)}`} style={style} aria-hidden="true">
      {initials(profile.username)}
    </span>
  );
  if (!flashOn && !online) return face;
  const badge = Math.max(14, Math.round(size * 0.38));
  const dot = Math.max(9, Math.round(size * 0.26));
  return (
    <span className="avatarflash" style={{ width: size, height: size }}>
      {face}
      {flashOn ? (
        <>
          <span className="avatarflash__bolt" style={{ width: badge, height: badge }} title={t('NOW ligado')} aria-hidden="true">
            <BoltIcon filled />
          </span>
          <span className="visually-hidden">{t('NOW ligado')}</span>
        </>
      ) : null}
      {online ? (
        <>
          <span className="avataronline" style={{ width: dot, height: dot }} title={t('Online')} aria-hidden="true" />
          <span className="visually-hidden">{t('Online')}</span>
        </>
      ) : null}
    </span>
  );
}

/** Linha de pessoa, usada em buscas e listas. Leva ao perfil. */
export function PersonRow({ profile, aside, realName = false }: { profile: PublicProfile; aside?: ReactNode; realName?: boolean }) {
  return (
    <li className="person">
      <Link to={`/u/${encodeURIComponent(profile.username)}`} className="person__link">
        <Avatar profile={profile} />
        <span className="person__body">
          <span className="person__name">{realName ? profile.displayName : profile.username}</span>
          {realName ? <span className="person__handle">@{profile.username}</span> : null}
        </span>
      </Link>
      {aside ? <div className="person__aside">{aside}</div> : null}
    </li>
  );
}

// ---------- Estrutura de página ----------

export function PageHead({ title, back, subtitle, titleTo, action }: { title: string; back?: string; subtitle?: string; titleTo?: string; action?: ReactNode }) {
  return (
    <header className="pagehead">
      {back ? (
        <Link to={back} className="pagehead__back" aria-label={t('Voltar')}>
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
      {action ? <div className="pagehead__action">{action}</div> : null}
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
          {t('Cancelar')}
        </Button>
      </div>
    </div>
  );
}

/** Círculo do grupo: a inicial do nome sobre uma cor fixa (ainda não há foto de grupo). */
export function GroupAvatar({ name, size = 44, imageUrl }: { name: string; size?: number; imageUrl?: string | null }) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '#';
  const image = groupPhotoSrc(imageUrl);
  return (
    <span className="avatar avatar--group" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {image ? <img className="avatar--group__img" src={image} alt="" /> : letter}
    </span>
  );
}
