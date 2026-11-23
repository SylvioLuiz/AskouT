/**
 * Ponte `window.AskouTLocation`: pede a permissão de localização do aparelho pelo sistema (Android e iPhone)
 * antes de o app web usar navigator.geolocation. No Android, o WebView sozinho não mostra o pedido e a
 * localização aparecia como bloqueada.
 */
type PermState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';
export interface LocationBridgeDeps {
  checkPermissions: () => Promise<{ location: PermState; coarseLocation?: PermState }>;
  requestPermissions: () => Promise<{ location: PermState; coarseLocation?: PermState }>;
}

const ok = (p: { location: PermState; coarseLocation?: PermState }) => p.location === 'granted' || p.coarseLocation === 'granted';

export function createLocationBridge(deps: LocationBridgeDeps) {
  return {
    /** 'granted' quando dá para ler a posição; 'denied' quando a pessoa recusou (ou bloqueou nas configurações). */
    async ensure(): Promise<'granted' | 'denied'> {
      try {
        const current = await deps.checkPermissions();
        if (ok(current)) return 'granted';
        // Também quando já foi recusada: o Android deixa pedir de novo até a pessoa marcar "não perguntar".
        return ok(await deps.requestPermissions()) ? 'granted' : 'denied';
      } catch {
        // Serviço de localização desligado no aparelho: deixa o navegador tentar e mostrar o erro dele.
        return 'granted';
      }
    },
  };
}

type Geo = Pick<Geolocation, 'getCurrentPosition' | 'watchPosition' | 'clearWatch'>;
const deniedError = { code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;

/**
 * Faz navigator.geolocation pedir a permissão do sistema antes de ler a posição, para todas as telas do app
 * web (NOW, Explorar, região, mapas) sem mudar nenhuma delas.
 */
export function guardGeolocation(geo: Geo, ensure: () => Promise<'granted' | 'denied'>): void {
  const get = geo.getCurrentPosition.bind(geo);
  const watch = geo.watchPosition.bind(geo);
  const clear = geo.clearWatch.bind(geo);
  const ids = new Map<number, number | null>();
  let next = 1_000_000;
  geo.getCurrentPosition = (ok, fail, options) => {
    void ensure().then((r) => (r === 'denied' ? fail?.(deniedError) : get(ok, fail, options)));
  };
  geo.watchPosition = (ok, fail, options) => {
    const id = next++;
    ids.set(id, null);
    void ensure().then((r) => {
      if (!ids.has(id)) return; // cancelado antes da resposta
      if (r === 'denied') {
        ids.delete(id);
        fail?.(deniedError);
      } else ids.set(id, watch(ok, fail, options));
    });
    return id;
  };
  geo.clearWatch = (id) => {
    const real = ids.get(id);
    ids.delete(id);
    if (real !== undefined && real !== null) clear(real);
    else if (real === undefined) clear(id);
  };
}

/** O que o plugin de localização do Capacitor usa (getCurrentPosition, watchPosition, clearWatch). */
export interface NativeGeoPlugin {
  getCurrentPosition(options?: PositionOptions): Promise<NativePosition>;
  watchPosition(options: PositionOptions & { minimumUpdateInterval?: number; interval?: number }, callback: (position: NativePosition | null, err?: unknown) => void): Promise<string>;
  clearWatch(options: { id: string }): Promise<void>;
}
export interface NativePosition {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number; altitude?: number | null; altitudeAccuracy?: number | null; heading?: number | null; speed?: number | null };
}

/** Mensagem que o app web reconhece: a localização do celular (GPS/serviços de localização) está desligada. */
export const SERVICES_OFF = 'askout:services-off';

/**
 * Erro do plugin no formato do navegador (code 1 = permissão, 2 = sem posição, 3 = demorou). Os códigos do
 * plugin no Android são "OS-PLUG-GLOC-00NN"; no iPhone vêm só com a mensagem.
 */
export function toGeoError(err: unknown): GeolocationPositionError {
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : String(err ?? '');
  const n = Number(/(\d{4})$/.exec(code)?.[1] ?? NaN);
  const make = (c: 1 | 2 | 3, m: string) => ({ code: c, message: m, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;
  if (n === 3 || /denied|permission|not authori[sz]ed/i.test(message)) return make(1, message);
  if (n === 7 || n === 9 || n === 17 || /services are not enabled|location services|turned off|disabled/i.test(message)) return make(2, SERVICES_OFF);
  if (n === 10 || /time ?out|in time/i.test(message)) return make(3, message);
  return make(2, message);
}

function toWebPosition(p: NativePosition): GeolocationPosition {
  const c = p.coords;
  const coords = { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy, altitude: c.altitude ?? null, altitudeAccuracy: c.altitudeAccuracy ?? null, heading: c.heading ?? null, speed: c.speed ?? null };
  return { timestamp: p.timestamp, coords: { ...coords, toJSON: () => coords } as GeolocationCoordinates, toJSON: () => ({ timestamp: p.timestamp, coords }) } as GeolocationPosition;
}

/**
 * No app (Android e iPhone), navigator.geolocation passa a ler pelo GPS nativo (plugin do Capacitor) em vez do
 * WebView: no Android o WebView às vezes nunca responde (localização só "aproximada", GPS desligado) e a tela ficava
 * em "ligando a localização" ou dizia que estava desligada sem conseguir ligar. O plugin também mostra o pedido do
 * sistema para ligar a localização do celular. Todas as telas do app web seguem iguais (mesma API do navegador).
 */
export function useNativeGeolocation(geo: Geo, plugin: NativeGeoPlugin, ensure: () => Promise<'granted' | 'denied'>): void {
  const watches = new Map<number, { nativeId?: string; cancelled?: boolean }>();
  let next = 2_000_000;
  const opts = (o?: PositionOptions): PositionOptions => ({ enableHighAccuracy: o?.enableHighAccuracy ?? false, timeout: o?.timeout ?? 20_000, maximumAge: o?.maximumAge ?? 0 });
  geo.getCurrentPosition = (ok, fail, options) => {
    void ensure().then(async (r) => {
      if (r === 'denied') return fail?.(deniedError);
      try {
        ok(toWebPosition(await plugin.getCurrentPosition(opts(options))));
      } catch (err) {
        fail?.(toGeoError(err));
      }
    });
  };
  geo.watchPosition = (ok, fail, options) => {
    const id = next++;
    const entry: { nativeId?: string; cancelled?: boolean } = {};
    watches.set(id, entry);
    let failed = false;
    void ensure().then(async (r) => {
      if (entry.cancelled) return;
      if (r === 'denied') {
        watches.delete(id);
        return fail?.(deniedError);
      }
      try {
        const nativeId = await plugin.watchPosition({ ...opts(options), minimumUpdateInterval: 3_000, interval: 5_000 }, (position, err) => {
          if (entry.cancelled || failed) return;
          if (position) return ok(toWebPosition(position));
          // Como no navegador: um erro encerra esta leitura; quem chamou decide se tenta de novo.
          failed = true;
          void plugin.clearWatch({ id: entry.nativeId ?? '' }).catch(() => undefined);
          watches.delete(id);
          fail?.(toGeoError(err));
        });
        entry.nativeId = nativeId;
        if (entry.cancelled || failed) void plugin.clearWatch({ id: nativeId }).catch(() => undefined);
      } catch (err) {
        watches.delete(id);
        fail?.(toGeoError(err));
      }
    });
    return id;
  };
  geo.clearWatch = (id) => {
    const entry = watches.get(id);
    watches.delete(id);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.nativeId) void plugin.clearWatch({ id: entry.nativeId }).catch(() => undefined);
  };
}
