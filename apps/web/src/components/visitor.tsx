import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { Link, navigate, usePathname } from '../router.tsx';
import { safeStorage } from '../lib/hints.ts';
import { requestPosition } from '../lib/position.ts';
import { HERE_ID, VISITOR_CITIES, VISITOR_CITY_EVENT, readVisitorCity, rememberLoginReturn, saveVisitorCity } from '../lib/visitor-city.ts';
import type { VisitorCity } from '../lib/visitor-city.ts';
import { t } from '../lib/i18n/index.ts';
import { Sheet } from './agenda.tsx';
import { BoltIcon, ChevronDownIcon, HomeIcon, LocationIcon, SearchIcon, UserIcon } from './icons.tsx';
import { Button, EmptyState, ErrorState, Loading, Notice } from './ui.tsx';
import { EventCard } from '../screens/explore.tsx';
import { EndGlow } from './end-glow.tsx';
import { useMediaQuery } from '../lib/use-desktop.ts';

// ---------- "Entre para continuar" ----------

const NEED_LOGIN_EVENT = 'askout:need-login';

/** Ação que exige conta (Eu vou, seguir, denunciar, Explorar...): abre o aviso para entrar ou criar conta. */
export function askLogin(reason?: string): void {
  window.dispatchEvent(new CustomEvent(NEED_LOGIN_EVENT, { detail: { reason } }));
}

function goToLogin(path: '/entrar' | '/cadastro') {
  rememberLoginReturn(safeStorage(), window.location.pathname + window.location.search);
  navigate(path);
}

function LoginPromptHost() {
  const [open, setOpen] = useState<{ reason?: string } | undefined>();
  useEffect(() => {
    const onNeed = (event: Event) => setOpen({ reason: (event as CustomEvent<{ reason?: string }>).detail?.reason });
    window.addEventListener(NEED_LOGIN_EVENT, onNeed);
    return () => window.removeEventListener(NEED_LOGIN_EVENT, onNeed);
  }, []);
  if (!open) return null;
  return (
    <Sheet title={t('Entre para continuar')} onClose={() => setOpen(undefined)}>
      <p>{open.reason ?? t('Para isso você precisa de uma conta no AskouT. É rápido e grátis.')}</p>
      <div className="sheetactions">
        <Button full onClick={() => { setOpen(undefined); goToLogin('/entrar'); }}>
          {t('Entrar')}
        </Button>
        <Button full variant="secondary" onClick={() => { setOpen(undefined); goToLogin('/cadastro'); }}>
          {t('Criar conta')}
        </Button>
      </div>
    </Sheet>
  );
}

// ---------- Cidade escolhida à mão ----------

/** A cidade do visitante (undefined enquanto não escolheu). Atualiza quando muda em outra parte do app. */
export function useVisitorCity(): VisitorCity | undefined {
  const [city, setCity] = useState(() => readVisitorCity(safeStorage()));
  useEffect(() => {
    const onChange = () => setCity(readVisitorCity(safeStorage()));
    window.addEventListener(VISITOR_CITY_EVENT, onChange);
    return () => window.removeEventListener(VISITOR_CITY_EVENT, onChange);
  }, []);
  return city;
}

function chooseCity(city: { id: string; position: { lat: number; lng: number } }) {
  saveVisitorCity(safeStorage(), city);
  window.dispatchEvent(new CustomEvent(VISITOR_CITY_EVENT));
}

const OPEN_CITY_EVENT = 'askout:open-city-picker';
export function openCityPicker(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CITY_EVENT));
}

function CityPickerHost() {
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const current = useVisitorCity();
  useEffect(() => {
    const onOpen = () => {
      setProblem(undefined);
      setOpen(true);
    };
    window.addEventListener(OPEN_CITY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CITY_EVENT, onOpen);
  }, []);
  if (!open) return null;

  // Só pede a localização do aparelho se a pessoa tocar aqui.
  async function useMine() {
    setLocating(true);
    setProblem(undefined);
    const result = await requestPosition();
    setLocating(false);
    if (result.status !== 'ok') {
      setProblem(result.status === 'denied' ? t('A localização está bloqueada. Escolha uma cidade da lista.') : t('Não deu para achar sua localização. Escolha uma cidade da lista.'));
      return;
    }
    chooseCity({ id: HERE_ID, position: result.position });
    setOpen(false);
  }

  return (
    <Sheet title={t('Escolha sua cidade')} onClose={() => setOpen(false)}>
      <p className="muted">{t('Mostramos os rolês perto da cidade escolhida. Nada é enviado sobre você.')}</p>
      <ul className="citylist">
        {VISITOR_CITIES.map((city) => (
          <li key={city.id}>
            <button
              type="button"
              className={`citylist__item${current?.id === city.id ? ' citylist__item--on' : ''}`}
              aria-pressed={current?.id === city.id}
              onClick={() => {
                chooseCity(city);
                setOpen(false);
              }}
            >
              {city.name}
            </button>
          </li>
        ))}
      </ul>
      <Button full variant="secondary" loading={locating} onClick={() => void useMine()}>
        <LocationIcon /> {t('Usar minha localização')}
      </Button>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
    </Sheet>
  );
}

/** Sem cidade escolhida, nada é carregado: só pede a cidade ou o login. */
export function VisitorCityGate({ children }: { children: ReactNode }) {
  const city = useVisitorCity();
  if (city) return <>{children}</>;
  return (
    <div className="visitorgate">
      <EmptyState
        title={t('Onde você quer sair?')}
        action={
          <div className="visitorgate__actions">
            <Button full onClick={openCityPicker}>
              <LocationIcon /> {t('Escolher cidade')}
            </Button>
            <Button full variant="secondary" onClick={() => goToLogin('/entrar')}>
              {t('Entrar')}
            </Button>
          </div>
        }
      >
        {t('Escolha sua cidade para ver os rolês e eventos perto, ou entre na sua conta.')}
      </EmptyState>
    </div>
  );
}

// ---------- Home do visitante ----------

const VISITOR_RADIUS_KM = 30;
const DAY_MS = 86_400_000;

/** Home sem conta: eventos dos locais perto da cidade escolhida. Sem pessoas, sem posts, sem busca (busca é no Explorar, com conta). */
export function VisitorHomeScreen() {
  useTitle(t('Home'));
  return (
    <VisitorCityGate>
      <VisitorEvents />
    </VisitorCityGate>
  );
}

function VisitorEvents() {
  const city = useVisitorCity()!;
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<import('../lib/types.ts').ExploreEvent[]>([]);
  const loaded = useAsync(async () => {
    const from = new Date();
    return api.explore({ lat: city.position.lat, lng: city.position.lng, radiusKm: VISITOR_RADIUS_KM, from: from.toISOString(), to: new Date(from.getTime() + 30 * DAY_MS).toISOString(), offset });
  }, [city.position.lat, city.position.lng, offset]);
  useEffect(() => setOffset(0), [city.id]);
  useEffect(() => {
    if (!loaded.data) return;
    const page = loaded.data.events;
    setItems((current) => (offset === 0 ? page : [...current, ...page.filter((e) => !current.some((c) => c.id === e.id))]));
  }, [loaded.data, offset]);
  const now = new Date();
  const desktop = useMediaQuery('(min-width: 900px)');
  return (
    <section className="section enter" aria-labelledby="visitante-titulo">
      <div className="section__head">
        <h2 id="visitante-titulo" className="section__title">
          {t('Rolês perto de {city}', { city: city.id === HERE_ID ? t('você') : city.name })}
        </h2>
        <button type="button" className="linkbtn" onClick={openCityPicker}>
          {t('Trocar cidade')}
        </button>
      </div>
      {loaded.error && offset === 0 ? <ErrorState message={loaded.error.message} onRetry={loaded.reload} /> : null}
      {loaded.loading && items.length === 0 ? <Loading /> : null}
      {!loaded.loading && !loaded.error && items.length === 0 ? (
        <EmptyState title={t('Nenhum rolê por aqui ainda')}>{t('Tente outra cidade ou entre para buscar no Explorar.')}</EmptyState>
      ) : null}
      {items.length > 0 ? (
        // Celular: um por linha, no cartão grande da Home logada. Computador: dois por linha, capa à esquerda.
        <ul className={desktop ? 'evgrid' : 'evposters'}>
          {items.map((event) => (
            <EventCard key={event.id} event={event} now={now} poster={!desktop} />
          ))}
        </ul>
      ) : null}
      {loaded.data?.hasMore ? (
        <Button full variant="secondary" loading={loaded.loading} onClick={() => setOffset(offset + loaded.data!.events.length)}>
          {t('Ver mais')}
        </Button>
      ) : null}
      <div className="visitorcta">
        <p>{t('Entre para buscar no Explorar, ver o mapa, dizer “Eu vou” e seguir seus lugares favoritos.')}</p>
        <Button full onClick={() => goToLogin('/cadastro')}>
          {t('Criar conta')}
        </Button>
      </div>
      <EndGlow />
    </section>
  );
}

// ---------- Moldura do visitante ----------

function CityButton() {
  const city = useVisitorCity();
  return (
    <button type="button" className="visitorcity" onClick={openCityPicker} aria-label={city ? t('Cidade: {city}. Trocar', { city: city.name }) : t('Escolher cidade')}>
      <LocationIcon />
      <span className="visitorcity__name">{city ? (city.id === HERE_ID ? t('Perto de você') : city.name) : t('Cidade')}</span>
      <ChevronDownIcon />
    </button>
  );
}

/**
 * Navegação de quem não entrou: no cabeçalho, a cidade (escolhida à mão, sem pedir localização) e o botão Entrar no lugar de conversas,
 * notificações e perfil. Embaixo: Home, Explorar e NOW (pedem login) e Entrar.
 */
export function VisitorShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const topbarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  const inEvent = /^\/eventos\/[^/]+$/.test(pathname);
  const home = pathname === '/';
  const exploreNeedsLogin = () => askLogin(t('O Explorar, com busca e mapa, é para quem tem conta. Entre ou crie a sua em instantes.'));
  const navItems = (
    <>
      <Link to="/" className={`navlink${home ? ' navlink--active' : ''}`} aria-current={home ? 'page' : undefined}>
        <span className="navlink__icon"><HomeIcon /></span>
        <span className="navlink__label">{t('Home')}</span>
      </Link>
      <button type="button" className="navlink navlink--button" onClick={exploreNeedsLogin}>
        <span className="navlink__icon"><SearchIcon /></span>
        <span className="navlink__label">{t('Explorar')}</span>
      </button>
      <button type="button" className="navlink navlink--button" onClick={() => askLogin(t('O NOW avisa seus amigos que você está livre para sair agora. Entre para usar.'))}>
        <span className="navlink__icon"><BoltIcon /></span>
        <span className="navlink__label">{t('NOW')}</span>
      </button>
      <button type="button" className="navlink navlink--button" onClick={() => goToLogin('/entrar')}>
        <span className="navlink__icon"><UserIcon /></span>
        <span className="navlink__label">{t('Entrar')}</span>
      </button>
    </>
  );
  return (
    <div className={`shell shell--visitor${inEvent ? ' shell--detail' : ''}`}>
      <a className="skip" href="#conteudo">
        {t('Ir para o conteúdo')}
      </a>
      <aside className="rail">
        <Link to="/" className="wordmark" aria-label={t('AskouT, ir para a Home')}>
          {t('AskouT')}
        </Link>
        <nav className="rail__nav" aria-label={t('Principal')}>
          {navItems}
        </nav>
        <CityButton />
      </aside>
      <header className="topbar" ref={topbarRef}>
        <Link to="/" className="wordmark" aria-label={t('AskouT, ir para a Home')}>
          {t('AskouT')}
        </Link>
        <nav className="topbar__actions" aria-label={t('Visitante')}>
          <CityButton />
          <button type="button" className="btn btn--primary btn--small" onClick={() => goToLogin('/entrar')}>
            {t('Entrar')}
          </button>
        </nav>
      </header>
      <main id="conteudo" className="content" tabIndex={-1}>
        {children}
      </main>
      <nav className="tabbar tabbar--visitor" aria-label={t('Principal')}>
        {navItems}
      </nav>
      <LoginPromptHost />
      <CityPickerHost />
    </div>
  );
}
