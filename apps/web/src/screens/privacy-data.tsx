import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ErrorState, Loading, Notice, PageHead } from '../components/ui.tsx';
import { BellIcon, ChevronRightIcon, DocIcon, HelpIcon, LockIcon, ShieldIcon, UserIcon } from '../components/icons.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { downloadJson } from '../lib/account.ts';
import { toApiError } from '../lib/errors.ts';
import { supportMailto } from '../lib/help-mailto.ts';
import type { ConsentPurpose, ConsentStatus } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

type Message = { tone: 'ok' | 'error'; text: string };

function purposeLabel(purpose: ConsentPurpose): string {
  return purpose === 'MARKETING_EMAIL' ? t('Novidades e ofertas por e-mail') : t('Novidades e ofertas por notificação');
}

function purposeHelp(purpose: ConsentPurpose): string {
  return purpose === 'MARKETING_EMAIL'
    ? t('Lançamentos, dicas e rolês em destaque. Avisos sobre a sua conta e a sua segurança chegam sempre, mesmo desligado.')
    : t('Promoções e novidades do AskouT. Avisos de amigos, conversas e eventos continuam em Notificações.');
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** Linha de menu que leva a outra tela. */
function Row({ to, href, icon, label, value }: { to?: string; href?: string; icon: ReactNode; label: string; value?: string | undefined }) {
  const inner = (
    <>
      <span className="menulist__lead" aria-hidden="true">
        {icon}
      </span>
      <span className="menulist__label">{label}</span>
      {value ? <span className="menulist__value">{value}</span> : null}
      <ChevronRightIcon />
    </>
  );
  return <li>{href ? <a href={href} className="menulist__item">{inner}</a> : <Link to={to ?? '/'} className="menulist__item">{inner}</Link>}</li>;
}

/**
 * Privacidade e dados, no padrão dos apps grandes: um lugar só para os consentimentos opcionais,
 * os direitos da LGPD (corrigir, baixar, apagar), os documentos aceitos e o histórico do que a pessoa autorizou.
 */
export function PrivacyDataScreen() {
  useTitle(t('Privacidade e dados'));
  const user = useUser();
  const view = useAsync(() => api.consents(), []);
  const [status, setStatus] = useState<ConsentStatus>();
  const [busy, setBusy] = useState<ConsentPurpose | 'export'>();
  const [message, setMessage] = useState<Message>();
  const support = supportMailto(import.meta.env['VITE_SUPPORT_EMAIL'] as string | undefined, user.profile.username);

  useEffect(() => {
    if (view.data) setStatus(view.data);
  }, [view.data]);

  if (view.loading && !status) return <Loading />;
  if (view.error && !status) return <ErrorState message={view.error.message} onRetry={view.reload} />;
  if (!status) return null;

  async function toggle(purpose: ConsentPurpose, granted: boolean) {
    setBusy(purpose);
    setMessage(undefined);
    try {
      setStatus(await api.setConsent(purpose, granted));
      setMessage({ tone: 'ok', text: granted ? t('Pronto, ligado. Você pode desligar quando quiser.') : t('Pronto, desligado. Não vamos mais usar seus dados para isso.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(undefined);
    }
  }

  async function download() {
    setBusy('export');
    setMessage(undefined);
    try {
      const file = await api.exportMyData();
      downloadJson(file.filename, file.data);
      setMessage({ tone: 'ok', text: t('Pronto. O arquivo com os seus dados foi baixado. Ele não inclui fotos e vídeos, só o registro de que existem.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(undefined);
    }
  }

  const terms = status.terms;
  // Só a data, para caber ao lado do título no celular; o histórico abaixo mostra o "aceito em" completo.
  const termsValue = terms.acceptedAt ? formatDate(terms.acceptedAt) : undefined;

  return (
    <>
      <PageHead title={t('Privacidade e dados')} back="/configuracao" />
      <p className="muted privacyhub__intro">{t('Você decide o que o AskouT faz com os seus dados. O que é opcional começa desligado e pode ser mudado a qualquer momento.')}</p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <h2 className="settingshub__group">{t('Comunicações opcionais')}</h2>
      {status.consents.map((consent) => {
        const id = `consent-${consent.purpose}`;
        return (
          <section key={consent.purpose} className="setting">
            <div className="setting__text">
              <h3 className="setting__title" id={id}>
                {purposeLabel(consent.purpose)}
              </h3>
              <p className="setting__help">
                {purposeHelp(consent.purpose)}
                {consent.updatedAt ? ` ${consent.granted ? t('Ligado em {date}.', { date: formatDate(consent.updatedAt) }) : t('Desligado em {date}.', { date: formatDate(consent.updatedAt) })}` : ''}
              </p>
            </div>
            <button type="button" role="switch" aria-checked={consent.granted} aria-labelledby={id} className="switch" disabled={busy !== undefined} aria-busy={busy === consent.purpose || undefined} onClick={() => void toggle(consent.purpose, !consent.granted)}>
              <span className="switch__thumb" />
            </button>
          </section>
        );
      })}

      <h2 className="settingshub__group">{t('Como seus dados são usados')}</h2>
      <ul className="menulist">
        <Row to="/privacidade" icon={<ShieldIcon />} label={t('Quem vê seu perfil, recomendações e região')} value={user.profile.isPrivate ? t('Privada') : t('Pública')} />
        <Row to="/configuracao/notificacoes" icon={<BellIcon />} label={t('Notificações da sua conta')} />
      </ul>
      <p className="muted privacyhub__note">{t('Câmera, fotos, localização e contatos só são usados quando você toca na função e permite. Para revogar, use as configurações do seu celular ou do navegador.')}</p>

      <h2 className="settingshub__group">{t('Seus direitos')}</h2>
      <ul className="menulist">
        <Row to="/perfil/editar" icon={<UserIcon />} label={t('Corrigir meus dados')} />
        <li>
          <button type="button" className="menulist__item" onClick={() => void download()} disabled={busy !== undefined} aria-busy={busy === 'export' || undefined}>
            <span className="menulist__lead" aria-hidden="true">
              <DocIcon />
            </span>
            <span className="menulist__label">{busy === 'export' ? t('Preparando o arquivo…') : t('Baixar uma cópia dos meus dados')}</span>
          </button>
        </li>
        {support ? <Row href={support} icon={<HelpIcon />} label={t('Falar com o encarregado de dados')} /> : null}
        <li>
          <Link to="/privacidade/apagar-conta" className="menulist__item menulist__item--danger menulist__item--start">
            <span className="menulist__lead" aria-hidden="true">
              <LockIcon />
            </span>
            <span className="menulist__label">{t('Apagar minha conta')}</span>
          </Link>
        </li>
      </ul>

      <h2 className="settingshub__group">{t('Documentos')}</h2>
      <ul className="menulist">
        <Row to="/termos-de-uso" icon={<DocIcon />} label={t('Termos de Uso')} value={termsValue} />
        <Row to="/politica-de-privacidade" icon={<DocIcon />} label={t('Política de Privacidade')} value={termsValue} />
      </ul>

      <details className="privacyhub__history">
        <summary>{t('Histórico de consentimentos')}</summary>
        <ul>
          {status.history.map((item) => (
            <li key={`${item.purpose}-${item.at}-${String(item.granted)}`}>
              <span>
                {purposeLabel(item.purpose)}: <strong>{item.granted ? t('ligado') : t('desligado')}</strong>
                {item.source === 'SIGNUP' ? ` · ${t('no cadastro')}` : ''}
              </span>
              <time dateTime={item.at}>{formatDateTime(item.at)}</time>
            </li>
          ))}
          {terms.acceptedAt ? (
            <li>
              <span>
                {t('Termos de Uso e Política de Privacidade')}: <strong>{t('aceitos')}</strong> · {t('versão {version}', { version: terms.acceptedVersion ?? '' })}
              </span>
              <time dateTime={terms.acceptedAt}>{formatDateTime(terms.acceptedAt)}</time>
            </li>
          ) : null}
        </ul>
      </details>
    </>
  );
}
