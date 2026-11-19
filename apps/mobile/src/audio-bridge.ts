/**
 * Ponte `window.AskouTAudio`: mensagens de voz tocadas pelo próprio iPhone (plugin nativo AudioPlugin.swift),
 * para o áudio não aparecer no "Tocando agora" da central de controle e da tela de bloqueio.
 * Contrato do lado web: apps/web/src/lib/native-audio.ts.
 */

export interface AudioStopped {
  key: string;
  positionMs: number;
  /** true: chegou ao fim; false: o iPhone cortou o som (ligação, alarme). */
  finished: boolean;
}

export interface AudioPluginLike {
  play(o: { key: string; data?: string; mime?: string; offsetMs: number }): Promise<{ durationMs: number; positionMs: number }>;
  pause(): Promise<{ positionMs: number }>;
  stop(): Promise<void>;
  addListener(event: 'stopped', cb: (e: AudioStopped) => void): Promise<{ remove(): Promise<void> }>;
}

export function createAudioBridge(plugin: AudioPluginLike) {
  return {
    play: (o: { key: string; data?: string; mime?: string; offsetMs: number }) => plugin.play(o),
    pause: () => plugin.pause(),
    stop: () => plugin.stop(),
    /** Escuta o fim (ou o corte) do áudio; devolve a função que para de escutar. */
    onStopped(cb: (e: AudioStopped) => void): () => void {
      const handle = plugin.addListener('stopped', cb);
      return () => {
        void handle.then((h) => h.remove()).catch(() => undefined);
      };
    },
  };
}
