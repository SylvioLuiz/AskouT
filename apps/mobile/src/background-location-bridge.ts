/**
 * Ponte `window.AskouTBackgroundLocation`: posição com o celular bloqueado, só enquanto a pessoa mostra a chegada
 * a um amigo no NOW (plugin @capacitor-community/background-geolocation).
 *
 * - Android: o plugin roda um serviço em primeiro plano, com um aviso fixo ("Mostrando sua chegada…"). Usa a
 *   permissão "durante o uso" (não pede "o tempo todo").
 * - iPhone: `UIBackgroundModes = location` no Info.plist; o iPhone mostra a barra azul de localização em uso.
 *
 * O envio ao servidor sai pelo HTTP nativo (`put`): depois de ~5 min em segundo plano o Android segura as
 * requisições feitas pelo WebView.
 */

export interface BackgroundFix {
  lat: number;
  lng: number;
  accuracyM: number;
  time: number;
}

export interface BackgroundPluginLike {
  addWatcher(
    options: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (location?: { latitude: number; longitude: number; accuracy: number; time: number | null }, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

/** Plugin do próprio app (ArrivalProgressPlugin.java, só Android): troca o aviso fixo por um com a barra de progresso. */
export interface ArrivalProgressPluginLike {
  update(options: { title: string; text: string; progress: number; arrived: boolean }): Promise<{ shown: boolean }>;
}

export interface NativeHttpLike {
  request(options: { method: string; url: string; headers: Record<string, string>; data?: unknown }): Promise<{ status: number }>;
}

export function createBackgroundLocationBridge(deps: { plugin: BackgroundPluginLike; http: NativeHttpLike; progress?: ArrivalProgressPluginLike | undefined }) {
  return {
    /**
     * Começa a acompanhar a posição. `onFix` recebe cada posição nova; `onError('NOT_AUTHORIZED')` quando a pessoa
     * não deu a permissão. Devolve uma função que para tudo (some o aviso fixo do Android).
     */
    async start(options: { title: string; message: string; onFix: (fix: BackgroundFix) => void; onError?: (code: string) => void }): Promise<() => Promise<void>> {
      const id = await deps.plugin.addWatcher(
        { backgroundTitle: options.title, backgroundMessage: options.message, requestPermissions: true, stale: false, distanceFilter: 25 },
        (location, error) => {
          if (error) {
            options.onError?.(error.code ?? 'ERROR');
            return;
          }
          if (!location) return;
          options.onFix({ lat: location.latitude, lng: location.longitude, accuracyM: Math.round(location.accuracy), time: location.time ?? Date.now() });
        },
      );
      let stopped = false;
      return async () => {
        if (stopped) return;
        stopped = true;
        await deps.plugin.removeWatcher({ id });
      };
    },
    /** Envia JSON pelo HTTP nativo. Devolve o status (0 se falhou a conexão). */
    async put(url: string, headers: Record<string, string>, body: unknown): Promise<number> {
      try {
        return (await deps.http.request({ method: 'PUT', url, headers: { 'Content-Type': 'application/json', ...headers }, data: body })).status;
      } catch {
        return 0;
      }
    },
    openSettings: () => deps.plugin.openSettings(),
    /**
     * Atualiza o aviso fixo com quanto falta (texto) e a barra (0–100). Só no Android com o plugin do app; no iPhone
     * (barra azul do sistema) e em versões antigas do app não faz nada.
     */
    async progress(update: { title: string; text: string; progress: number; arrived: boolean }): Promise<void> {
      if (!deps.progress) return;
      try {
        await deps.progress.update(update);
      } catch {
        // Sem o aviso atualizado a chegada segue igual.
      }
    },
  };
}

export type BackgroundLocationBridge = ReturnType<typeof createBackgroundLocationBridge>;
