/**
 * Player nativo das mensagens de voz no app do iPhone (`window.AskouTAudio`, ver apps/mobile/src/audio-bridge.ts).
 * Pelo WebView o iPhone mostra o áudio no "Tocando agora"; pelo plugin do app, não.
 */

export interface NativeAudioStopped {
  key: string;
  positionMs: number;
  finished: boolean;
}

export interface NativeAudio {
  play(o: { key: string; data?: string; mime?: string; offsetMs: number }): Promise<{ durationMs: number; positionMs: number }>;
  pause(): Promise<{ positionMs: number }>;
  stop(): Promise<void>;
  onStopped(cb: (e: NativeAudioStopped) => void): () => void;
}

export function nativeAudio(host: unknown = typeof window === 'undefined' ? undefined : window): NativeAudio | undefined {
  const b = (host as { AskouTAudio?: Partial<NativeAudio> } | undefined)?.AskouTAudio;
  return b && typeof b.play === 'function' && typeof b.pause === 'function' && typeof b.stop === 'function' && typeof b.onStopped === 'function' ? (b as NativeAudio) : undefined;
}

/** Código do erro que o plugin devolveu (`UNSUPPORTED`, `MISSING`...), se houver. */
export function nativeErrorCode(failure: unknown): string | undefined {
  const code = (failure as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Bytes em base64 (o que a ponte do Capacitor leva para o lado nativo). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

interface PcmLike {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Áudio já decodificado em WAV (PCM 16 bits, mono): formato que o iPhone sempre toca. Usado quando o arquivo
 * original não abre no player do iPhone (WebM/Opus gravado no Android, por exemplo).
 */
export function encodeWav(pcm: PcmLike): Uint8Array {
  const frames = pcm.length;
  const channels = Math.max(1, pcm.numberOfChannels);
  const data = new Array<Float32Array>(channels);
  for (let c = 0; c < channels; c++) data[c] = pcm.getChannelData(c);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  const rate = Math.round(pcm.sampleRate);
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data[c]![i] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / channels));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return bytes;
}
