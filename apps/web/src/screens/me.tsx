import { useEffect, useState } from 'react';
import { NOW_RADIUS_CHOICES_KM, nowRadiusKm, setNowRadiusKm } from '../lib/now-radius.ts';
import type { FormEvent, ReactNode } from 'react';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { MuteCard, PushCard } from '../components/notifications.tsx';
import { api } from '../client.ts';
import { useAuthContext, useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { formatWhen } from '../lib/chat.ts';
import { readPersonalize, savePersonalize } from '../lib/dwell.ts';
import { toApiError } from '../lib/errors.ts';
import { roundCoordinate } from '../lib/boost.ts';
import { pluralize } from '../lib/format.ts';
import { statusLabel } from '../lib/meetup.ts';
import type { RegionView } from '../lib/types.ts';
import { applyTheme, readTheme, saveTheme, THEME_LABELS } from '../lib/theme.ts';
import type { ThemeChoice } from '../lib/theme.ts';
import { BIO_MAX, bioProblem, compact, displayNameProblem } from '../lib/validation.ts';
import { InviteSheet } from '../components/invite.tsx';
import { ConnectContactsCard } from '../components/connect-contacts.tsx';
import { ActivityLog } from '../components/activity-log.tsx';
import { PhotoPickerSheet } from '../components/photo-picker.tsx';
import { AvatarCropper } from '../components/avatar-cropper.tsx';
import { AvatarViewer } from '../components/photo-viewer.tsx';
import { BellIcon, BlockIcon, BoltIcon, ChevronLeftIcon, ChevronRightIcon, DocIcon, GlobeIcon, HelpIcon, LockIcon, LogoutIcon, MoonIcon, ShieldIcon, SunIcon, UserIcon, UsersIcon } from '../components/icons.tsx';
import { formatPhone, normalizePhone } from '../lib/phone.ts';
import { supportMailto } from '../lib/help-mailto.ts';
import { downloadJson } from '../lib/account.ts';
import { birthDateProblem, MIN_ACCOUNT_AGE, ageOnDate, todayIso } from '../lib/age.ts';
import { Link } from '../router.tsx';
import { LOCALES, chooseLocale, getLocale, intlLocale, t } from '../lib/i18n/index.ts';

/** Versão mostrada no rodapé das configurações. */
const APP_VERSION = (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? '0.1.0';

type Message = { tone: 'ok' | 'error'; text: string } | undefined;

/** Foto escolhida que ainda não foi salva: já enquadrada no círculo (data URL JPEG), ou o pedido de remover. */
type PendingPhoto = { image: string } | 'remove' | undefined;

/**
 * Editar perfil: foto, nome, descrição, celular e data de nascimento num formulário só.
 * Nada é gravado até tocar em "Salvar alterações"; aí vai tudo o que mudou de uma vez.
 */
export function EditProfileScreen() {
  useTitle(t('Editar perfil'));
  const user = useUser();
  const { setOwnProfile } = useAuthContext();
  const view = useAsync(() => Promise.all([api.getProfile(user.profile.username), api.getPhone(), api.ageStatus()]), [user.profile.username]);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [birth, setBirth] = useState('');
  const [photo, setPhoto] = useState<PendingPhoto>();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File>();
  const [viewOpen, setViewOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>();
  const [saving, setSaving] = useState(false);
  // O que está salvo no servidor, para mandar só o que mudou.
  const [saved, setSaved] = useState<{ displayName: string; bio: string; phone: string; birth: string; avatarUrl: string | null } | undefined>();

  const loaded = view.data;
  useEffect(() => {
    if (!loaded) return;
    const [profileView, phoneView, age] = loaded;
    const now = { displayName: profileView.profile.displayName, bio: profileView.profile.bio ?? '', phone: phoneView.phone ? formatPhone(phoneView.phone) : '', birth: age.birthDate ?? '', avatarUrl: profileView.profile.avatarUrl };
    setSaved(now);
    setDisplayName(now.displayName);
    setBio(now.bio);
    setPhone(now.phone);
    setBirth(now.birth);
    setPhoto(undefined);
  }, [loaded]);

  if (view.loading && !loaded) return <Loading />;
  if (view.error && !loaded) return <ErrorState message={view.error.message} onRetry={view.reload} />;
  if (!loaded || !saved) return null;
  const age = loaded[2];
  const support = supportMailto(import.meta.env['VITE_SUPPORT_EMAIL'] as string | undefined, user.profile.username);

  const shownAvatar = photo === 'remove' ? null : photo ? photo.image : saved.avatarUrl;
  const changed = photo !== undefined || displayName !== saved.displayName || bio !== saved.bio || phone !== saved.phone || (!age.locked && birth !== saved.birth);

  function problems(): Record<string, string> {
    const birthProblem =
      age.locked || birth === saved!.birth
        ? undefined
        : (birthDateProblem(birth, new Date()) ?? (ageOnDate(birth, new Date()) < MIN_ACCOUNT_AGE ? t('O AskouT é para quem tem {MIN_ACCOUNT_AGE} anos ou mais', { MIN_ACCOUNT_AGE }) : undefined));
    const phoneProblem = phone.trim() !== '' && phone !== saved!.phone && !normalizePhone(phone) ? t('Informe o celular com DDD, ex.: (11) 98765-4321') : undefined;
    return compact({ displayName: displayNameProblem(displayName, true), bio: bioProblem(bio), phone: phoneProblem, birthDate: birthProblem });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = problems();
    setErrors(found);
    setMessage(undefined);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    const next = { ...saved! };
    try {
      if (photo !== undefined) {
        const image = photo === 'remove' ? null : photo.image;
        const updated = await api.setProfilePhoto(image);
        next.avatarUrl = updated.avatarUrl;
        setPhoto(undefined);
      }
      if (displayName !== saved!.displayName || bio !== saved!.bio || photo !== undefined) {
        const updated = await api.updateProfile({ displayName: displayName.trim(), bio: bio.trim() });
        setOwnProfile({ userId: updated.userId, username: updated.username, displayName: updated.displayName, avatarUrl: updated.avatarUrl, isPrivate: updated.isPrivate });
        next.displayName = updated.displayName;
        next.bio = updated.bio ?? '';
        next.avatarUrl = updated.avatarUrl;
      }
      if (phone !== saved!.phone) {
        const result = await api.setPhone(phone.trim() === '' ? null : phone);
        next.phone = result.phone ? formatPhone(result.phone) : '';
      }
      if (!age.locked && birth !== saved!.birth) {
        const result = await api.correctBirthDate(birth);
        next.birth = result.birthDate ?? '';
      }
      setSaved(next);
      setDisplayName(next.displayName);
      setBio(next.bio);
      setPhone(next.phone);
      setBirth(next.birth);
      setMessage({ tone: 'ok', text: t('Perfil atualizado.') });
    } catch (failure) {
      // O que já foi gravado antes do erro continua salvo.
      setSaved(next);
      const error = toApiError(failure);
      setErrors(error.fields);
      setMessage(Object.keys(error.fields).length === 0 ? { tone: 'error', text: error.message } : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Cabeçalho fixo como em apps nativos: voltar · título · Salvar sempre à vista. */}
      <header className="edithead">
        <Link to="/perfil" className="pagehead__back" aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </Link>
        <h1 className="edithead__title">{t('Editar perfil')}</h1>
        <button type="submit" form="edit-profile" className="edithead__save" disabled={!changed || saving} aria-busy={saving || undefined}>
          {saving ? t('Salvando…') : t('Salvar')}
        </button>
      </header>
      {photoOpen ? (
        <PhotoPickerSheet
          hasPhoto={shownAvatar !== null}
          onPick={setCropFile}
          onRemove={() => setPhoto(saved.avatarUrl ? 'remove' : undefined)}
          onView={() => setViewOpen(true)}
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}
      {cropFile ? (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(undefined)}
          onDone={(image) => {
            setPhoto({ image });
            setCropFile(undefined);
          }}
        />
      ) : null}
      {viewOpen && shownAvatar ? <AvatarViewer url={shownAvatar} onClose={() => setViewOpen(false)} /> : null}
      <form id="edit-profile" className="form form--flat" onSubmit={save} noValidate>
        <div className="photoedit">
          <button type="button" className="avatarbtn" onClick={() => setPhotoOpen(true)} aria-label={t('Editar foto')} aria-haspopup="dialog">
            <Avatar profile={{ userId: user.profile.userId, username: user.profile.username, displayName: displayName || user.profile.displayName, avatarUrl: shownAvatar }} size={96} />
          </button>
          <button type="button" className="photoedit__link" onClick={() => setPhotoOpen(true)} aria-haspopup="dialog">
            {t('Editar foto')}
          </button>
          {photo !== undefined ? <span className="muted photoedit__note">{t('A foto muda quando você salvar.')}</span> : null}
        </div>
        <Field label={t('Nome')} value={displayName} onChange={setDisplayName} error={errors['displayName']} maxLength={60} autoComplete="name" />
        <Field label={t('Descrição')} value={bio} onChange={setBio} error={errors['bio']} hint={`${Array.from(bio).length}/${BIO_MAX}`} multiline maxLength={BIO_MAX + 20} />
        <Field
          label={t('Celular')}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={setPhone}
          error={errors['phone']}
          autoComplete="tel"
          maxLength={25}
          placeholder="(11) 98765-4321"
          hint={t('Não aparece para ninguém. Serve para seus amigos acharem você pela agenda do celular.')}
        />
        {age.locked ? (
          <p className="muted">
            {t('Pela data cadastrada, você ainda não tem 18 anos, então não dá para trocá-la por aqui. Se foi um erro de digitação,')}{' '}
            {support ? <a href={support}>fale com o suporte</a> : 'fale com o suporte'}.
          </p>
        ) : (
          <Field
            label={t('Data de nascimento')}
            type="date"
            value={birth}
            onChange={setBirth}
            error={errors['birthDate']}
            max={todayIso()}
            autoComplete="bday"
            hint={age.declared ? t('Ela não aparece para ninguém. Serve para confirmar que você tem 18 anos ou mais.') : t('Você ainda não informou. Precisamos dela para confirmar que você tem 18 anos ou mais.')}
          />
        )}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </form>
    </>
  );
}

/** Uma linha da central de configurações: ícone, rótulo, valor atual (opcional) e seta. */
function SettingsRow({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value?: string | undefined }) {
  return (
    <li>
      <Link to={to} className="menulist__item">
        <span className="menulist__lead" aria-hidden="true">
          {icon}
        </span>
        <span className="menulist__label">{label}</span>
        {value ? <span className="menulist__value">{value}</span> : null}
        <ChevronRightIcon />
      </Link>
    </li>
  );
}

/**
 * Central de configurações, no padrão dos apps grandes (Instagram, WhatsApp, iOS):
 * cartão da conta no topo, grupos com título, cada linha mostrando o valor atual, e "Sair" por último.
 */
export function SettingsScreen() {
  useTitle(t('Configurações e privacidade'));
  const user = useUser();
  const { signOut } = useAuthContext();
  const theme = readTheme(window.localStorage);
  const language = LOCALES.find((item) => item.code === getLocale())?.label;
  const radius = nowRadiusKm();
  return (
    <>
      <PageHead title={t('Configurações e privacidade')} back="/perfil" />
      <Link to="/perfil/editar" className="settingshub__account">
        <Avatar profile={user.profile} size={56} />
        <span className="settingshub__who">
          <span className="settingshub__name">{user.profile.displayName}</span>
          <span className="settingshub__sub">@{user.profile.username}</span>
          <span className="settingshub__sub">{t('Editar perfil, foto e dados pessoais')}</span>
        </span>
        <ChevronRightIcon />
      </Link>

      <h2 className="settingshub__group">{t('Sua conta')}</h2>
      <ul className="menulist">
        <SettingsRow to="/configuracao/conta" icon={<UserIcon />} label={t('Informações da conta')} />
        <SettingsRow to="/configuracao/senha" icon={<LockIcon />} label={t('Senha e segurança')} />
        <SettingsRow to="/configuracao/verificacao-em-duas-etapas" icon={<ShieldIcon />} label={t('Verificação em duas etapas')} />
        <SettingsRow to="/configuracao/privacidade-e-dados" icon={<ShieldIcon />} label={t('Privacidade e dados')} />
      </ul>

      <h2 className="settingshub__group">{t('Como você usa o AskouT')}</h2>
      <ul className="menulist">
        <SettingsRow to="/configuracao/notificacoes" icon={<BellIcon />} label={t('Notificações')} />
        <SettingsRow to="/configuracao/now" icon={<BoltIcon />} label={t('NOW')} value={radius === null ? t('Automático') : `${radius} km`} />
      </ul>

      <h2 className="settingshub__group">{t('Quem pode ver seu conteúdo')}</h2>
      <ul className="menulist">
        <SettingsRow to="/privacidade" icon={<ShieldIcon />} label={t('Privacidade da conta')} value={user.profile.isPrivate ? t('Privada') : t('Pública')} />
        <SettingsRow to="/amigos" icon={<UsersIcon />} label={t('Amigos')} />
        <SettingsRow to="/bloqueados" icon={<BlockIcon />} label={t('Pessoas bloqueadas')} />
      </ul>

      <h2 className="settingshub__group">{t('Preferências do app')}</h2>
      <ul className="menulist">
        <SettingsRow to="/tema" icon={theme === 'dark' ? <MoonIcon /> : <SunIcon />} label={t('Tema')} value={theme === 'system' ? t('Automático') : THEME_LABELS[theme]} />
        <SettingsRow to="/tema" icon={<GlobeIcon />} label={t('Idioma')} value={language} />
      </ul>

      <h2 className="settingshub__group">{t('Suporte e sobre')}</h2>
      <ul className="menulist">
        <SettingsRow to="/ajuda" icon={<HelpIcon />} label={t('Central de ajuda')} />
        <SettingsRow to="/termos-de-uso" icon={<DocIcon />} label={t('Termos de Uso')} />
        <SettingsRow to="/politica-de-privacidade" icon={<DocIcon />} label={t('Política de Privacidade')} />
        <SettingsRow to="/padroes-de-seguranca-infantil" icon={<ShieldIcon />} label={t('Segurança infantil')} />
      </ul>

      <h2 className="settingshub__group">{t('Login')}</h2>
      <ul className="menulist">
        <li>
          <button type="button" className="menulist__item menulist__item--danger menulist__item--start" onClick={signOut}>
            <span className="menulist__lead" aria-hidden="true">
              <LogoutIcon />
            </span>
            <span className="menulist__label">{t('Sair de @{username}', { username: user.profile.username })}</span>
          </button>
        </li>
      </ul>
      <p className="settingshub__foot">AskouT · {t('versão {version}', { version: APP_VERSION })}</p>
    </>
  );
}

/** Informações da conta: dados de login, baixar uma cópia dos dados e apagar a conta (LGPD). */
export function AccountInfoScreen() {
  useTitle(t('Informações da conta'));
  const user = useUser();
  return (
    <>
      <PageHead title={t('Informações da conta')} back="/configuracao" />
      <dl className="eventpage__facts">
        <div>
          <dt>{t('Usuário')}</dt>
          <dd>@{user.profile.username}</dd>
        </div>
        <div>
          <dt>{t('E-mail')}</dt>
          <dd>{user.email}</dd>
        </div>
      </dl>
      <p className="muted">{t('Ainda não dá para trocar o e-mail por aqui.')}</p>
      <nav className="linklist" aria-label={t('Sua conta')}>
        <Link to="/perfil/editar">{t('Celular e data de nascimento')}</Link>
        <Link to="/configuracao/senha">{t('Trocar senha')}</Link>
      </nav>
      <MyDataSection />
    </>
  );
}

/** Notificações: avisos no aparelho e silenciar por um tempo. */
export function NotificationSettingsScreen() {
  useTitle(t('Notificações'));
  return (
    <>
      <PageHead title={t('Notificações')} back="/configuracao" />
      <h2 className="profile__section">{t('Avisos no aparelho')}</h2>
      <PushCard />
      <h2 className="profile__section">{t('Silenciar push')}</h2>
      <MuteCard />
    </>
  );
}

/** Preferências do NOW. */
export function NowSettingsScreen() {
  useTitle(t('NOW'));
  return (
    <>
      <PageHead title={t('NOW')} back="/configuracao" />
      <NowRadiusSetting />
    </>
  );
}

/** Até onde buscar rolês entre você e o amigo num encontro do NOW. Fica salvo neste aparelho. */
function NowRadiusSetting() {
  const [km, setKm] = useState<number | null>(() => nowRadiusKm());
  function choose(next: number | null) {
    setKm(next);
    setNowRadiusKm(next);
  }
  return (
    <section className="setting setting--stack">
      <div>
        <h2 className="setting__title" id="now-raio-titulo">
          {t('Distância dos rolês no NOW')}
        </h2>
        <p className="setting__help">{t('Até quantos km do meio do caminho entre você e o amigo buscar bares e eventos. No automático, a busca cresce quanto mais longe vocês estão.')}</p>
      </div>
      <div className="nowsort" role="radiogroup" aria-labelledby="now-raio-titulo">
        <button type="button" role="radio" aria-checked={km === null} aria-pressed={km === null} className="chip" onClick={() => choose(null)}>
          {t('Automático')}
        </button>
        {NOW_RADIUS_CHOICES_KM.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={km === option} aria-pressed={km === option} className="chip" onClick={() => choose(option)}>
            {option} km
          </button>
        ))}
      </div>
    </section>
  );
}

export function PrivacyScreen() {
  useTitle(t('Privacidade'));
  const user = useUser();
  const { setOwnProfile } = useAuthContext();
  const [isPrivate, setIsPrivate] = useState(user.profile.isPrivate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  /** Muda quando as recomendações personalizadas são ligadas ou desligadas, para a região refletir isso. */
  const [personalizeRev, setPersonalizeRev] = useState(0);

  async function toggle() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.setPrivacy(!isPrivate);
      setIsPrivate(result.isPrivate);
      setOwnProfile({ ...user.profile, isPrivate: result.isPrivate });
      setMessage({
        tone: 'ok',
        text: result.isPrivate
          ? t('Seu perfil agora é privado. Quem já segue continua seguindo; novos seguidores precisam da sua aprovação.')
          : result.acceptedPending > 0
            ? t('Seu perfil agora é público. {accepted}.', { accepted: pluralize(result.acceptedPending, t('pedido pendente foi aceito'), t('pedidos pendentes foram aceitos')) })
            : t('Seu perfil agora é público.'),
      });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('Privacidade')} back="/configuracao" />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title" id="privado-titulo">
            {t('Perfil privado')}
          </h2>
          <p className="setting__help">{t('Com o perfil privado, só quem você aprova vê seus eventos postados, sua agenda e suas conexões.')}</p>
        </div>
        <button type="button" role="switch" aria-checked={isPrivate} aria-labelledby="privado-titulo" className="switch" onClick={toggle} disabled={busy}>
          <span className="switch__thumb" />
        </button>
      </section>
      <PersonalizeSetting userId={user.profile.userId} onChange={() => setPersonalizeRev((n) => n + 1)} />
      <RegionSetting key={personalizeRev} userId={user.profile.userId} />
      <nav className="linklist" aria-label={t('Privacidade')}>
        <Link to="/atividades">{t('Pedidos para seguir')}</Link>
        <Link to="/bloqueados">{t('Pessoas bloqueadas')}</Link>
        <Link to={`/u/${encodeURIComponent(user.profile.username)}`}>{t('Ver como os outros veem')}</Link>
        <Link to="/politica-de-privacidade">{t('Política de Privacidade')}</Link>
        <Link to="/termos-de-uso">{t('Termos de Uso')}</Link>
      </nav>
      <nav className="linklist" aria-label={t('Seus dados')}>
        <Link to="/configuracao/privacidade-e-dados">{t('Privacidade e dados: consentimentos, baixar dados ou apagar a conta')}</Link>
      </nav>
    </>
  );
}

/** Seus dados: baixar uma cópia ou apagar a conta (LGPD). */
function MyDataSection() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function download() {
    setBusy(true);
    setMessage(undefined);
    try {
      const file = await api.exportMyData();
      downloadJson(file.filename, file.data);
      setMessage({ tone: 'ok', text: t('Pronto. O arquivo com os seus dados foi baixado. Ele não inclui fotos e vídeos, só o registro de que existem.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="setting setting--stack">
      <div>
        <h3 className="setting__title">{t('Seus dados')}</h3>
        <p className="setting__help">{t('Baixe uma cópia do que o AskouT guarda sobre você, ou apague a sua conta.')}</p>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button variant="secondary" loading={busy} onClick={() => void download()}>
        {t('Baixar meus dados')}
      </Button>
      <Link className="btn btn--quiet btn--danger-text" to="/privacidade/apagar-conta">
        {t('Apagar minha conta')}
      </Link>
    </section>
  );
}

/** Recomendações que usam o tempo que você fica em cada conteúdo. Ligado por padrão; dá para desligar e apagar o histórico. */
function PersonalizeSetting({ userId, onChange }: { userId: string; onChange: () => void }) {
  const [on, setOn] = useState(() => readPersonalize(userId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function change() {
    const next = !on;
    setOn(next);
    savePersonalize(userId, next);
    if (next) {
      setMessage({ tone: 'ok', text: t('Recomendações personalizadas ligadas.') });
      onChange();
      return;
    }
    // Desligar também apaga o que já foi medido e a região (sem comportamento, não há Match).
    setBusy(true);
    try {
      await Promise.all([api.eraseDwell(), api.clearRegion()]);
      setMessage({ tone: 'ok', text: t('Desligado. Apagamos o seu histórico de tempo na tela e a sua região. Você ainda vê o que os amigos fizeram, mas sem usar o seu comportamento.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: t('Desligamos, mas não deu para apagar o histórico agora: {message}', { message: toApiError(failure).message }) });
    } finally {
      setBusy(false);
      onChange();
    }
  }

  async function erase() {
    setBusy(true);
    try {
      const r = await api.eraseDwell();
      setMessage({ tone: 'ok', text: r.removed > 0 ? t('Histórico apagado.') : t('Não havia nada para apagar.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title" id="personalizar-titulo">
            {t('Recomendações personalizadas')}
          </h2>
          <p className="setting__help">{t('O app mede quanto tempo você fica em cada post ou evento, o que você curte, comenta, compartilha e confirma presença, e com quem você mais conversa (só quando e com quem, nunca o texto). Usa isso, junto com o que seus amigos mais próximos foram ou curtiram (com peso menor que o seu), para montar o bloco “Para você”. As medições ficam 60 dias e ninguém vê. A equipe vê apenas totais, nunca o seu histórico.')}</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="personalizar-titulo" className="switch" onClick={() => void change()} disabled={busy}>
          <span className="switch__thumb" />
        </button>
      </section>
      <div className="setting__actions">
        <Button variant="quiet" small loading={busy} onClick={() => void erase()}>
          {t('Apagar meu histórico de tempo na tela')}
        </Button>
      </div>
    </>
  );
}

/**
 * "Minha região" (opcional): a pessoa informa mais ou menos onde mora para receber rolês patrocinados que combinam com o gosto dela (Match).
 * Usa a localização uma única vez, guarda só a posição aproximada (~1 km) e a pessoa remove quando quiser.
 */
function RegionSetting({ userId }: { userId: string }) {
  const personalizing = readPersonalize(userId);
  const saved = useAsync(() => api.region(), []);
  const [region, setRegion] = useState<RegionView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();
  const current = region === undefined ? (saved.data?.region ?? null) : region;

  function useHere() {
    if (!('geolocation' in navigator)) {
      setMessage({ tone: 'error', text: t('Este aparelho não informa a localização.') });
      return;
    }
    setBusy(true);
    setMessage(undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api.saveRegion(roundCoordinate(pos.coords.latitude), roundCoordinate(pos.coords.longitude)).then(
          (r) => { setRegion(r.region); setMessage({ tone: 'ok', text: t('Região salva. Guardamos só uma posição aproximada, de cerca de 1 km.') }); },
          (failure) => setMessage({ tone: 'error', text: toApiError(failure).message }),
        ).finally(() => setBusy(false));
      },
      () => {
        setBusy(false);
        setMessage({ tone: 'error', text: t('Não consegui pegar a sua localização. Permita o acesso no navegador e tente de novo.') });
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15000 },
    );
  }

  async function remove() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.clearRegion();
      setRegion(null);
      setMessage({ tone: 'ok', text: t('Região apagada. Você deixa de receber anúncios Match.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title">{t('Minha região')}</h2>
          <p className="setting__help">
            {t('Opcional. Se você informar mais ou menos onde mora, bares e casas de show perto de você podem mostrar, no “Para você”, rolês com a etiqueta “Patrocinado” que combinam com o que você curte (por exemplo, rock). Usamos a localização uma vez e guardamos só uma posição aproximada, de cerca de 1 km. Quem anuncia vê apenas um número aproximado de pessoas, nunca quem você é. Funciona só com as recomendações personalizadas ligadas.')}
          </p>
          {current ? <p className="setting__help"><strong>{t('Região salva.')}</strong> Atualizada em {new Date(current.updatedAt).toLocaleDateString(intlLocale())}.</p> : null}
          {!personalizing ? <p className="setting__help">{t('Ligue as recomendações personalizadas para poder informar a região.')}</p> : null}
        </div>
      </section>
      <div className="setting__actions">
        <Button variant="secondary" small loading={busy} disabled={!personalizing} onClick={useHere}>
          {current ? t('Atualizar com minha localização atual') : t('Usar minha localização atual')}
        </Button>
        {current ? <Button variant="quiet" small disabled={busy} onClick={() => void remove()}>{t('Apagar minha região')}</Button> : null}
      </div>
    </>
  );
}

export function InteractionsScreen() {
  useTitle(t('Suas interações'));
  const meetups = useAsync(() => api.myMeetups(), []);
  const requests = useAsync(() => api.followRequests({ limit: 1 }), []);
  const items = meetups.data?.items ?? [];
  const now = Date.now();
  const upcoming = items.filter((m) => m.status === 'ACTIVE' && Date.parse(m.endsAt) > now);
  const past = items.filter((m) => !upcoming.includes(m));

  const row = (m: (typeof items)[number]) => (
    <li key={m.id}>
      <Link to={`/conversas/${encodeURIComponent(m.conversationId)}`} className="inter__row">
        <span className="inter__title">{m.title}</span>
        <span className="inter__sub">{m.status === 'CANCELLED' ? 'Cancelado' : formatWhen(m.startsAt, m.endsAt, new Date())}</span>
        {statusLabel(m.myStatus) ? <span className="inter__sub">{statusLabel(m.myStatus)}</span> : null}
      </Link>
    </li>
  );

  return (
    <>
      <PageHead title={t('Suas interações')} back="/perfil" />
      {(requests.data?.total ?? 0) > 0 ? (
        <Link to="/atividades" className="callout callout--link">
          <span className="callout__text">
            <strong>{pluralize(requests.data?.total ?? 0, 'pedido para seguir', 'pedidos para seguir')}</strong>
            <br />
            {t('Aprove ou recuse em Notificações.')}
          </span>
        </Link>
      ) : null}
      <h2 className="profile__section">{t('Seus encontros')}</h2>
      {meetups.loading && !meetups.data ? <Loading /> : null}
      {meetups.error ? <ErrorState message={meetups.error.message} onRetry={meetups.reload} /> : null}
      {meetups.data && items.length === 0 ? (
        <EmptyState
          title={t('Nenhum encontro ainda')}
          action={
            <Link to="/explorar" className="btn btn--primary">
              {t('Explorar eventos')}
            </Link>
          }
        >
          {t('Os encontros que você criar ou for convidado aparecem aqui.')}
        </EmptyState>
      ) : null}
      {upcoming.length > 0 ? <ul className="inter">{upcoming.map(row)}</ul> : null}
      {past.length > 0 ? (
        <>
          <h2 className="profile__section">{t('Anteriores')}</h2>
          <ul className="inter">{past.map(row)}</ul>
        </>
      ) : null}
      <h2 className="profile__section">{t('Seus eventos')}</h2>
      <Link to="/perfil" className="callout callout--link">
        <span className="callout__text">
          <strong>{t('Eventos postados no perfil')}</strong>
          <br />
          {t('Veja e tire eventos do seu perfil. Para postar, abra um evento e use Compartilhar.')}
        </span>
      </Link>
      <ActivityLog />
    </>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: t('Como viro amigo de alguém?'), a: t('Vocês viram amigos quando se seguem. Se o perfil for privado, a pessoa precisa aprovar seu pedido.') },
  { q: t('Como posto um evento no meu perfil?'), a: t('Abra o evento em Explorar, toque em Compartilhar e escolha Postar no meu perfil. Para tirar, use o mesmo botão ou Tirar do perfil na grade.') },
  { q: t('Como compartilho um evento?'), a: t('No evento, toque em Compartilhar: poste no perfil, envie numa conversa ou copie o link para mandar fora do app, por exemplo no WhatsApp.') },
  { q: t('Como marco um encontro?'), a: t('No evento, toque em Criar encontro e escolha quem convidar. Quem aceitar vê o encontro na Agenda.') },
  { q: t('O que é o NOW?'), a: t('É o botão para avisar seus amigos que você está livre agora. Quem também estiver livre pode te chamar, e a conversa abre na hora. Ele fica na barra de baixo.') },
  { q: t('Onde ficam minhas conversas?'), a: t('No ícone de balão, no topo da tela. Um número mostra quantas conversas têm mensagem nova.') },
  { q: t('Para que serve a Agenda?'), a: t('Ela mostra os eventos em que você confirmou presença e os encontros marcados. Você também pode marcar quando está livre. Só você vê.') },
  { q: t('Os eventos de exemplo são reais?'), a: t('Não. Eventos marcados como Exemplo de teste existem só para testar o app.') },
  { q: t('Como troco foto, nome ou descrição?'), a: t('No seu perfil, toque no lápis.') },
];

export function HelpScreen() {
  useTitle(t('Ajuda'));
  const user = useUser();
  const mailto = supportMailto(import.meta.env.VITE_SUPPORT_EMAIL as string | undefined, user.profile.username);
  return (
    <>
      <PageHead title={t('Ajuda')} back="/configuracao" />
      <div className="faq">
        {FAQ.map((item) => (
          <details key={item.q} className="faq__item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
      {mailto ? (
        <a className="btn btn--secondary btn--full" href={mailto}>
          {t('Falar com o suporte')}
        </a>
      ) : (
        <p className="muted">{t('O canal de suporte por e-mail ainda não foi ativado.')}</p>
      )}
    </>
  );
}

export function ThemeScreen() {
  useTitle(t('Tema e idioma'));
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme(window.localStorage));
  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next, document.documentElement);
    saveTheme(next, window.localStorage);
  }
  return (
    <>
      <PageHead title={t('Tema e idioma')} back="/configuracao" />
      <div className="radios" role="radiogroup" aria-label={t('Tema')}>
        {(['system', 'light', 'dark'] as const).map((id) => (
          <label key={id} className="radios__item">
            <input type="radio" name="tema" checked={choice === id} onChange={() => pick(id)} />
            <span>{THEME_LABELS[id]}</span>
          </label>
        ))}
      </div>
      <h3 className="settings__sub">{t('Idioma')}</h3>
      <div className="radios" role="radiogroup" aria-label={t('Idioma')}>
        {LOCALES.map((item) => (
          <label key={item.code} className="radios__item">
            <input type="radio" name="idioma" checked={getLocale() === item.code} onChange={() => chooseLocale(item.code)} />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </>
  );
}

export function FriendsScreen() {
  useTitle(t('Amigos'));
  const friends = useAsync(() => api.friends(), []);
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <PageHead title={t('Amigos')} back="/perfil" subtitle={t('Pessoas que seguem você e que você segue')} action={<Link to="/amigos/contatos">{t('Achar nos contatos')}</Link>} />
      <ConnectContactsCard />
      <Button full variant="secondary" onClick={() => setInviting(true)}>
        {t('Convidar amigos para o AskouT')}
      </Button>
      {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}
      {friends.loading && !friends.data ? <Loading /> : null}
      {friends.error ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
      {friends.data && friends.data.length === 0 ? (
        <EmptyState
          title={t('Nenhum amigo ainda')}
          action={
            <Link to="/explorar" className="btn btn--primary">
              {t('Encontrar pessoas')}
            </Link>
          }
        >
          {t('Você e outra pessoa viram amigos quando se seguem.')}
        </EmptyState>
      ) : null}
      {friends.data && friends.data.length > 0 ? (
        <>
          <p className="muted">{pluralize(friends.data.length, 'amigo', 'amigos')}</p>
          <ul className="list">
            {friends.data.map((friend) => (
              <PersonRow key={friend.userId} profile={friend} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

export function BlockedScreen() {
  useTitle(t('Pessoas bloqueadas'));
  const blocked = useAsync(() => api.blocks(), []);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  async function unblock(userId: string, username: string) {
    setBusyId(userId);
    setMessage(undefined);
    try {
      await api.unblock(userId);
      if (blocked.data) blocked.setData(blocked.data.filter((p) => p.userId !== userId));
      setMessage({ tone: 'ok', text: t('Você desbloqueou @{username}.', { username }) });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <>
      <PageHead title={t('Pessoas bloqueadas')} back="/perfil" />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {blocked.loading && !blocked.data ? <Loading /> : null}
      {blocked.error ? <ErrorState message={blocked.error.message} onRetry={blocked.reload} /> : null}
      {blocked.data && blocked.data.length === 0 ? <EmptyState title={t('Você não bloqueou ninguém')}>{t('Quem você bloquear aparece aqui, e dá para desbloquear quando quiser.')}</EmptyState> : null}
      {blocked.data && blocked.data.length > 0 ? (
        <ul className="list">
          {blocked.data.map((profile) => (
            <PersonRow
              key={profile.userId}
              profile={profile}
              aside={
                <Button small variant="secondary" loading={busyId === profile.userId} onClick={() => unblock(profile.userId, profile.username)}>
                  {t('Desbloquear')}
                </Button>
              }
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
