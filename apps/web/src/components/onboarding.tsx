import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { useAuthContext, useUser } from '../auth.tsx';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { parseInvite, takeInvite } from '../lib/invite.ts';
import { followProgressLabel, markOnboardingDone, ONBOARDING_FOLLOW_GOAL, ONBOARDING_SLIDES, onboardingDone, placesFromEvents, shouldShowOnboarding } from '../lib/onboarding.ts';
import { positionWithin } from '../lib/position.ts';
import { filterByThemes, saveThemes, themeFilter, themesOfCategory } from '../lib/themes.ts';
import type { ThemeId } from '../lib/themes.ts';
import type { ExplorePlace, PublicProfile } from '../lib/types.ts';
import { BoltIcon, HomeIcon, UserIcon } from './icons.tsx';
import { TastePicker, toggleTaste } from './tastes.tsx';
import { Avatar, Button, Field, Loading } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

const SLIDE_ICONS = [<HomeIcon key="h" />, <UserIcon key="u" />, <BoltIcon key="b" filled />];

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Rolês para o passo guiado: os locais perto (AskouT e de fora), como no mapa do Explorar. Sem localização ou sem nada
 * perto, os locais dos próximos eventos. (A busca do Explorar sem texto não traz locais, só eventos.)
 */
async function loadFollowPlaces(): Promise<ExplorePlace[]> {
  const position = await positionWithin(POSITION_WAIT_MS);
  if (position) {
    const nearby = await api.explorePlaces({ lat: position.lat, lng: position.lng }).catch(() => null);
    const open = nearby?.places.filter((p) => !p.venue?.following) ?? [];
    if (open.length > 0) return open;
  }
  const upcoming = await api.explore(position ? { lat: position.lat, lng: position.lng } : {});
  return placesFromEvents(upcoming.events);
}

const POSITION_WAIT_MS = 8000;

function FollowStep({ themes, onDone }: { themes: ReadonlySet<ThemeId>; onDone: () => void }) {
  const places = useAsync(loadFollowPlaces, []);
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const all = places.data ?? [];
  const byTheme = filterByThemes(all, themes, (p) => themesOfCategory(p.category));
  // Se nada bate com o tema escolhido (fonte de fora fora do ar, locais sem tipo), mostra o que houver em vez de uma tela vazia.
  const list = (byTheme.length > 0 ? byTheme : all).slice(0, 12);

  async function follow(place: ExplorePlace) {
    setBusy(place.key);
    setProblem(undefined);
    try {
      const venueId = place.venue?.id ?? (await api.openExternalVenue({ key: place.key, lat: place.lat, lng: place.lng })).venueId;
      if (!followed.has(place.key)) await api.followVenue(venueId);
      setFollowed((current) => new Set(current).add(place.key));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(undefined);
    }
  }

  const ready = followed.size >= ONBOARDING_FOLLOW_GOAL;
  return (
    <>
      <h2 id="onb-titulo" className="onb__title">{t('Siga 3 locais para começar')}</h2>
      <p className="onb__text">{t('É assim que a sua Home ganha eventos. Você pode seguir e deixar de seguir quando quiser.')}</p>
      {places.loading ? <Loading shape="tiles" /> : null}
      {places.error ? <p className="muted">{t('Não deu para listar locais agora. Você pode seguir depois, em Explorar.')}</p> : null}
      {!places.loading && !places.error && list.length === 0 ? <p className="muted">{t('Ainda não há locais por aqui. Você pode procurar depois, em Explorar.')}</p> : null}
      <ul className="onb__places">
        {list.map((place) => {
          const on = followed.has(place.key);
          return (
            <li key={place.key} className="onb__place">
              <span className="onb__placeinfo">
                <strong>{place.name}</strong>
                {place.category || place.address ? <span className="muted">{place.category ?? place.address}</span> : null}
              </span>
              <Button small variant={on ? 'secondary' : 'primary'} loading={busy === place.key} disabled={on} aria-pressed={on} onClick={() => follow(place)}>
                {on ? t('Seguindo') : t('Seguir')}
              </Button>
            </li>
          );
        })}
      </ul>
      {problem ? <p className="field__error" role="alert">{problem}</p> : null}
      <p className="onb__progress" role="status">{followProgressLabel(followed.size)}</p>
      <div className="onb__actions">
        <Button full onClick={onDone} variant={ready ? 'primary' : 'secondary'}>{ready ? t('Ir para a Home') : followed.size > 0 ? t('Continuar assim mesmo') : t('Pular por agora')}</Button>
      </div>
    </>
  );
}

function ThemeStep({ chosen, onToggle, onNext }: { chosen: ReadonlySet<ThemeId>; onToggle: (id: ThemeId) => void; onNext: () => void }) {
  return (
    <>
      <h2 id="onb-titulo" className="onb__title">{t('O que você curte?')}</h2>
      <p className="onb__text">{t('Escolha um ou mais. Vamos sugerir rolês do seu jeito. Dá para mudar depois, nas configurações.')}</p>
      <TastePicker chosen={chosen} onToggle={onToggle} />
      <div className="onb__actions">
        <Button full onClick={onNext}>{chosen.size > 0 ? t('Continuar') : t('Gosto de tudo')}</Button>
      </div>
    </>
  );
}

/**
 * Convite que se perdeu na instalação: "Foi @fulano quem te chamou?" quando o servidor achou o toque no link pela mesma
 * rede; senão, um campo discreto para digitar o @ de quem convidou.
 */
function InviteAsk({ suggested, onAccept, onDismiss }: { suggested: PublicProfile | undefined; onAccept: (who: string) => Promise<void>; onDismiss: () => void }) {
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function confirm(who: string | undefined) {
    if (!who) {
      setProblem(t('Digite o @ de quem te convidou.'));
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await onAccept(who);
    } catch {
      setProblem(t('Não achamos @{username}. Confira o nome e tente de novo.', { username: who }));
    } finally {
      setBusy(false);
    }
  }

  if (suggested && !typing) {
    return (
      <div className="onb__ask" role="group" aria-label={t('Convite')}>
        <div className="onb__askwho">
          <Avatar profile={suggested} size={36} />
          <p>{t('Foi @{username} quem te chamou para o AskouT?', { username: suggested.username })}</p>
        </div>
        <div className="onb__askactions">
          <Button small loading={busy} onClick={() => confirm(suggested.username)}>{t('Sim, foi')}</Button>
          <Button
            small
            variant="quiet"
            onClick={() => {
              onDismiss();
              setTyping(false);
            }}
          >
            {t('Não')}
          </Button>
        </div>
        {problem ? <p className="field__error" role="alert">{problem}</p> : null}
      </div>
    );
  }
  if (!typing) {
    return (
      <button type="button" className="onb__asklink" onClick={() => setTyping(true)}>
        {t('Alguém te convidou?')}
      </button>
    );
  }
  return (
    <form
      className="onb__ask"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm(parseInvite(name));
      }}
    >
      <Field label={t('Quem te convidou?')} prefix="@" value={name} onChange={setName} autoComplete="off" maxLength={31} autoFocus error={problem} />
      <div className="onb__askactions">
        <Button small type="submit" loading={busy}>{t('Confirmar')}</Button>
        <Button small variant="quiet" onClick={() => setTyping(false)}>{t('Cancelar')}</Button>
      </div>
    </form>
  );
}

/** Primeiro login: 3 telas curtas e o passo “siga 3 rolês”. Aparece uma vez por conta, em qualquer aparelho. */
export function Onboarding() {
  const user = useUser();
  const { setSessionUser } = useAuthContext();
  const [open, setOpen] = useState(() => shouldShowOnboarding(storage(), user));
  // Quem já viu o tutorial neste navegador antes de ele ser guardado na conta: registra na conta, sem mostrar de novo.
  useEffect(() => {
    if (user.onboarded === false && onboardingDone(storage(), user.id)) api.completeOnboarding().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<ReadonlySet<ThemeId>>(new Set());
  const [invited, setInvited] = useState<string | undefined>();
  const [invitedFriend, setInvitedFriend] = useState(false);
  // Convite que não veio junto (a pessoa baixou o app pela loja): quem tocou no link pela mesma rede, para confirmar.
  const [suggested, setSuggested] = useState<PublicProfile | undefined>();

  /** Registra o convite: a API anota quem convidou e já deixa as duas pessoas amigas. Se não contar, só segue quem convidou. */
  async function accept(who: string): Promise<void> {
    const { counted } = await api.claimReferral(who);
    if (!counted) await api.getProfile(who).then((view) => api.follow(view.profile.userId));
    setInvitedFriend(counted);
    setInvited(who);
    setSuggested(undefined);
  }

  // Cadastro por link de convite (o app abriu pelo link): registra direto. Sem o convite junto, pergunta ao servidor
  // se alguém da mesma rede tocou num link de convite antes de baixar o app.
  useEffect(() => {
    if (!open) return;
    const who = takeInvite(storage());
    if (who && who !== user.profile.username) {
      accept(who).catch(() => undefined);
      return;
    }
    api
      .pendingReferral()
      .then(({ inviter }) => {
        if (inviter && inviter.username !== user.profile.username) setSuggested(inviter);
      })
      .catch(() => undefined);
    // Roda uma vez, ao abrir pela primeira vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!open) return null;
  const toggle = (id: ThemeId) => setChosen((current) => toggleTaste(current, id));
  const finish = () => {
    markOnboardingDone(storage(), user.id);
    // Guarda na conta para não aparecer em outro aparelho; se falhar, o navegador já lembra.
    api.completeOnboarding().catch(() => undefined);
    setOpen(false);
  };
  const slide = ONBOARDING_SLIDES[step];
  return (
    <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-titulo">
      <div className="onb__card">
        {slide ? (
          <>
            <div className="onb__art" aria-hidden="true">{SLIDE_ICONS[step]}</div>
            <h2 id="onb-titulo" className="onb__title">{slide.title}</h2>
            <p className="onb__text">{slide.text}</p>
            {invited && step === 0 ? <p className="onb__invited" role="status">{invitedFriend ? t('Você entrou pelo convite de @{invited} e vocês já são amigos.', { invited }) : t('Você entrou pelo convite de @{invited} e já segue essa pessoa.', { invited })}</p> : null}
            {!invited && step === 0 ? <InviteAsk suggested={suggested} onAccept={accept} onDismiss={() => setSuggested(undefined)} /> : null}
            <div className="onb__dots" aria-hidden="true">
              {ONBOARDING_SLIDES.map((s, i) => (
                <span key={s.title} className={`onb__dot${i === step ? ' onb__dot--on' : ''}`} />
              ))}
            </div>
            <div className="onb__actions">
              <Button full onClick={() => setStep(step + 1)}>{step === ONBOARDING_SLIDES.length - 1 ? t('Escolher meus rolês') : t('Próximo')}</Button>
              <Button full variant="quiet" onClick={finish}>{t('Pular')}</Button>
            </div>
          </>
        ) : step === ONBOARDING_SLIDES.length ? (
          <ThemeStep
            chosen={chosen}
            onToggle={toggle}
            onNext={() => {
              const tastes = [...chosen];
              saveThemes(storage(), user.id, tastes);
              // Guarda na conta (vale em outro aparelho e aparece nas configurações); se falhar, o navegador já lembra.
              api
                .setTastes(tastes)
                .then((saved) => setSessionUser({ ...user, tastes: saved.tastes }))
                .catch(() => undefined);
              setStep(step + 1);
            }}
          />
        ) : (
          <FollowStep themes={themeFilter([...chosen])} onDone={finish} />
        )}
      </div>
    </div>
  );
}
