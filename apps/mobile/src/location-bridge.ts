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
