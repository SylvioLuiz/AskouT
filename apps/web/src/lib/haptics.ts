/**
 * Vibração curta de confirmação (deu certo arrastar, segurar, passar de um ponto). No app do celular vai pelo motor
 * de vibração do aparelho (`window.AskouTHaptics`, ver apps/mobile/src/main.ts): no iPhone o `navigator.vibrate`
 * não existe. No navegador, usa o `navigator.vibrate` quando há; sem nenhum dos dois, não faz nada.
 */
export type HapticKind = 'tick' | 'tap' | 'success';

export interface NativeHaptics {
  play(kind: HapticKind): Promise<void>;
}

const VIBRATE_MS: Record<HapticKind, number> = { tick: 4, tap: 10, success: 14 };

export function nativeHaptics(host: unknown = typeof window === 'undefined' ? undefined : window): NativeHaptics | undefined {
  const b = (host as { AskouTHaptics?: Partial<NativeHaptics> } | undefined)?.AskouTHaptics;
  return b && typeof b.play === 'function' ? (b as NativeHaptics) : undefined;
}

export function haptic(kind: HapticKind = 'tap', host: unknown = typeof window === 'undefined' ? undefined : window): void {
  const native = nativeHaptics(host);
  if (native) {
    void native.play(kind).catch(() => undefined);
    return;
  }
  const nav = (host as { navigator?: { vibrate?: (ms: number) => boolean } } | undefined)?.navigator;
  try {
    nav?.vibrate?.(VIBRATE_MS[kind]);
  } catch {
    // navegador que bloqueia a vibração sem toque recente: segue sem vibrar
  }
}
