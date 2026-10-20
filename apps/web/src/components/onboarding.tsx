import { useState } from 'react';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { followProgressLabel, markOnboardingDone, ONBOARDING_FOLLOW_GOAL, ONBOARDING_SLIDES, onboardingDone } from '../lib/onboarding.ts';
import { filterByThemes, saveThemes, THEMES, themeOfCategory } from '../lib/themes.ts';
import type { ThemeId } from '../lib/themes.ts';
import type { ExplorePlace } from '../lib/types.ts';
import { BoltIcon, HomeIcon, UserIcon } from './icons.tsx';
import { Button, Loading } from './ui.tsx';

const SLIDE_ICONS = [<HomeIcon key="h" />, <UserIcon key="u" />, <BoltIcon key="b" filled />];

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function FollowStep({ themes, onDone }: { themes: ReadonlySet<ThemeId>; onDone: () => void }) {
  const places = useAsync(() => api.explore({}), []);
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const all = places.data?.places ?? [];
  const byTheme = filterByThemes(all, themes, (p) => themeOfCategory(p.category));
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
      <h2 id="onb-titulo" className="onb__title">Siga 3 rolês para começar</h2>
      <p className="onb__text">É assim que a sua Home ganha eventos. Você pode seguir e deixar de seguir quando quiser.</p>
      {places.loading ? <Loading /> : null}
      {places.error ? <p className="muted">Não deu para listar rolês agora. Você pode seguir depois, em Explorar.</p> : null}
      {!places.loading && !places.error && list.length === 0 ? <p className="muted">Ainda não há rolês por aqui. Você pode procurar depois, em Explorar.</p> : null}
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
                {on ? 'Seguindo' : 'Seguir'}
              </Button>
            </li>
          );
        })}
      </ul>
      {problem ? <p className="field__error" role="alert">{problem}</p> : null}
      <p className="onb__progress" role="status">{followProgressLabel(followed.size)}</p>
      <div className="onb__actions">
        <Button full onClick={onDone} variant={ready ? 'primary' : 'secondary'}>{ready ? 'Ir para a Home' : followed.size > 0 ? 'Continuar assim mesmo' : 'Pular por agora'}</Button>
      </div>
    </>
  );
}

function ThemeStep({ chosen, onToggle, onNext }: { chosen: ReadonlySet<ThemeId>; onToggle: (id: ThemeId) => void; onNext: () => void }) {
  return (
    <>
      <h2 id="onb-titulo" className="onb__title">O que você curte?</h2>
      <p className="onb__text">Escolha um ou mais. Vamos sugerir rolês do seu jeito.</p>
      <ul className="onb__themes">
        {THEMES.map((theme) => {
          const on = chosen.has(theme.id);
          return (
            <li key={theme.id}>
              <button type="button" className={`onb__theme${on ? ' onb__theme--on' : ''}`} aria-pressed={on} onClick={() => onToggle(theme.id)}>
                <strong>{theme.label}</strong>
                <span>{theme.hint}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="onb__actions">
        <Button full onClick={onNext}>{chosen.size > 0 ? 'Continuar' : 'Gosto de tudo'}</Button>
      </div>
    </>
  );
}

/** Primeira abertura: 3 telas curtas e o passo “siga 3 rolês”. Aparece uma vez por usuário. */
export function Onboarding() {
  const user = useUser();
  const [open, setOpen] = useState(() => !onboardingDone(storage(), user.id));
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<ReadonlySet<ThemeId>>(new Set());
  if (!open) return null;
  const toggle = (id: ThemeId) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const finish = () => {
    markOnboardingDone(storage(), user.id);
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
            <div className="onb__dots" aria-hidden="true">
              {ONBOARDING_SLIDES.map((s, i) => (
                <span key={s.title} className={`onb__dot${i === step ? ' onb__dot--on' : ''}`} />
              ))}
            </div>
            <div className="onb__actions">
              <Button full onClick={() => setStep(step + 1)}>{step === ONBOARDING_SLIDES.length - 1 ? 'Escolher meus rolês' : 'Próximo'}</Button>
              <Button full variant="quiet" onClick={finish}>Pular</Button>
            </div>
          </>
        ) : step === ONBOARDING_SLIDES.length ? (
          <ThemeStep
            chosen={chosen}
            onToggle={toggle}
            onNext={() => {
              saveThemes(storage(), user.id, [...chosen]);
              setStep(step + 1);
            }}
          />
        ) : (
          <FollowStep themes={chosen.size === THEMES.length ? new Set() : chosen} onDone={finish} />
        )}
      </div>
    </div>
  );
}
