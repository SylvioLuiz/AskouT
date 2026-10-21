import { POST_VIDEO_MAX_BYTES } from './post-video.ts';

/**
 * Prepara o vídeo antes de enviar: reduz para algo como 720p com a qualidade que importa, para o envio ser bem mais rápido.
 * Ordem: compressor NATIVO do aplicativo (iOS/Android, quando existir) → recodificador do navegador (WebCodecs) → arquivo original.
 * Nunca piora: se não der para comprimir, ou o resultado não ficar menor, segue o original.
 */

/** Maior lado do vídeo depois de comprimido (1280 = classe 720p, em pé ou deitado). */
export const VIDEO_MAX_EDGE = 1280;
/** Bitrate de vídeo desejado. Para o tamanho de tela de celular, 720p a ~3,5 Mbps quase não mostra perda. */
export const VIDEO_TARGET_BPS = 3_500_000;
const VIDEO_MIN_BPS = 600_000;
const AUDIO_BPS = 128_000;
/** O resultado precisa caber com folga no limite do servidor. */
const OUTPUT_BUDGET_BYTES = Math.floor(POST_VIDEO_MAX_BYTES * 0.92);
/** Abaixo disso o vídeo já é pequeno: não vale perder qualidade para ganhar segundos. */
const SMALL_ENOUGH_BYTES = 8 * 1024 * 1024;

export type SkipReason = 'small-enough' | 'unsupported' | 'not-smaller' | 'failed';

export interface PreparedVideo {
  file: File;
  compressed: boolean;
  /** Por que seguiu o arquivo original (só quando `compressed` é false). */
  reason?: SkipReason;
  originalBytes: number;
}

/**
 * Contrato com a casca nativa (Capacitor): `window.AskouTVideo.compress(arquivo, opções)` devolve o arquivo comprimido,
 * ou `undefined` se não conseguiu. A casca grava o arquivo no cache, chama o plugin e lê o resultado de volta.
 */
export interface NativeVideoCompressor {
  compress(file: File, options: { maxEdge: number; videoBitsPerSecond: number; onProgress?: (fraction: number) => void }): Promise<File | undefined>;
}

export function nativeCompressor(env: { AskouTVideo?: NativeVideoCompressor } = globalThis as never): NativeVideoCompressor | undefined {
  const native = env.AskouTVideo;
  return native && typeof native.compress === 'function' ? native : undefined;
}

/** Bitrate de vídeo que cabe no limite de envio para a duração dada (vídeos mais longos recebem um pouco menos). */
export function videoBitrateFor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return VIDEO_TARGET_BPS;
  const budget = (OUTPUT_BUDGET_BYTES * 8) / seconds - AUDIO_BPS;
  return Math.round(Math.min(VIDEO_TARGET_BPS, Math.max(VIDEO_MIN_BPS, budget)));
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Novo tamanho (números pares, mesma proporção) se o vídeo for maior que o limite; `undefined` se já cabe. */
export function fitWithin(width: number, height: number, maxEdge: number = VIDEO_MAX_EDGE): { width: number; height: number } | undefined {
  if (!(width > 0) || !(height > 0)) return undefined;
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return undefined;
  const scale = maxEdge / longest;
  return { width: even(width * scale), height: even(height * scale) };
}

/** Vale comprimir? Sim se passa do limite de envio, ou se é grande E bem acima do bitrate desejado. */
export function worthCompressing(input: { sizeBytes: number; seconds: number }): boolean {
  if (input.sizeBytes > POST_VIDEO_MAX_BYTES) return true;
  if (input.sizeBytes <= SMALL_ENOUGH_BYTES) return false;
  if (!Number.isFinite(input.seconds) || input.seconds <= 0) return true;
  const bps = (input.sizeBytes * 8) / input.seconds;
  return bps > (VIDEO_TARGET_BPS + AUDIO_BPS) * 1.25;
}

/** O navegador tem as peças básicas para recodificar? (o suporte ao H.264 em si só se sabe ao tentar) */
export function webCodecsPresent(env: { VideoEncoder?: unknown; VideoDecoder?: unknown } = globalThis as never): boolean {
  return typeof env.VideoEncoder === 'function' && typeof env.VideoDecoder === 'function';
}

/** Dá para reduzir este vídeo neste aparelho? Decide se escolher um arquivo maior que o limite de envio ainda vale a pena. */
export async function canCompressVideo(): Promise<boolean> {
  if (nativeCompressor()) return true;
  if (!webCodecsPresent()) return false;
  try {
    const mb = await import('mediabunny');
    return await mb.canEncodeVideo('avc', { width: 1280, height: 720, bitrate: VIDEO_TARGET_BPS });
  } catch {
    return false;
  }
}

export interface PrepareOptions {
  onProgress?: (fraction: number) => void;
  /** Cancelar enquanto otimiza (a pessoa saiu da tela). */
  signal?: AbortSignal;
  native?: NativeVideoCompressor | undefined;
  /** Só para teste: o navegador de teste não tem H.264, então a verificação usa VP9/WebM. */
  codec?: 'avc' | 'vp9';
}

function outputName(file: File, extension: string): string {
  const base = file.name.replace(/\.[^./\\]+$/, '') || 'video';
  return `${base}.${extension}`;
}

/** Reduz o vídeo; em qualquer dúvida devolve o original. Só lança se a pessoa cancelar. */
export async function prepareVideo(file: File, options: PrepareOptions = {}): Promise<PreparedVideo> {
  const original = (reason: SkipReason): PreparedVideo => ({ file, compressed: false, reason, originalBytes: file.size });
  const done = (out: File): PreparedVideo => ({ file: out, compressed: true, originalBytes: file.size });
  const useful = (out: File | undefined): out is File => out !== undefined && out.size > 0 && (out.size < file.size || file.size > POST_VIDEO_MAX_BYTES);

  const native = 'native' in options ? options.native : nativeCompressor();
  if (native) {
    try {
      const out = await native.compress(file, { maxEdge: VIDEO_MAX_EDGE, videoBitsPerSecond: VIDEO_TARGET_BPS, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
      if (useful(out)) return done(out);
    } catch {
      // O nativo falhou: tenta o navegador e, por fim, o original.
    }
  }

  if (!webCodecsPresent()) return original('unsupported');
  return compressOnWeb(file, options, original, done, useful);
}

async function compressOnWeb(
  file: File,
  options: PrepareOptions,
  original: (reason: SkipReason) => PreparedVideo,
  done: (out: File) => PreparedVideo,
  useful: (out: File | undefined) => out is File,
): Promise<PreparedVideo> {
  let mb: typeof import('mediabunny');
  try {
    mb = await import('mediabunny');
  } catch {
    return original('unsupported');
  }
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  let conversion: Awaited<ReturnType<typeof mb.Conversion.init>> | undefined;
  const onAbort = () => void conversion?.cancel();
  options.signal?.addEventListener('abort', onAbort);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return original('unsupported');
    const seconds = await input.computeDuration();
    if (!worthCompressing({ sizeBytes: file.size, seconds })) return original('small-enough');

    const codec = options.codec ?? 'avc';
    const size = fitWithin(track.displayWidth, track.displayHeight);
    const bitrate = videoBitrateFor(seconds);
    const target = size ?? { width: track.displayWidth, height: track.displayHeight };
    if (!(await mb.canEncodeVideo(codec, { width: target.width, height: target.height, bitrate }))) return original('unsupported');

    const output = new mb.Output({
      format: codec === 'avc' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
      target: new mb.BufferTarget(),
    });
    conversion = await mb.Conversion.init({
      input,
      output,
      // “fill”: a diferença de arredondamento para números pares é de 1 pixel, sem tarja nem distorção visível.
      video: { ...(size ? { ...size, fit: 'fill' as const } : {}), codec, bitrate, keyFrameInterval: 2 },
      showWarnings: false,
    });
    // Sem som não é compressão, é perda: se o áudio não puder ir junto, segue o original.
    if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track.isAudioTrack() || d.track.isVideoTrack())) return original('unsupported');

    if (options.onProgress) {
      const report = options.onProgress;
      conversion.onProgress = (fraction) => report(Math.min(1, Math.max(0, fraction)));
    }
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0) return original('failed');
    const out = new File([buffer], outputName(file, codec === 'avc' ? 'mp4' : 'webm'), { type: codec === 'avc' ? 'video/mp4' : 'video/webm' });
    return useful(out) ? done(out) : original('not-smaller');
  } catch (failure) {
    if (options.signal?.aborted || (failure instanceof Error && failure.name === 'ConversionCanceledError')) {
      throw new DOMException('Otimização cancelada', 'AbortError');
    }
    // Fica no console para quem for investigar; a pessoa só segue com o arquivo original.
    console.warn('Otimização do vídeo não funcionou; enviando o original.', failure);
    return original('failed');
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    input.dispose();
  }
}

/** “Otimizando o vídeo… 42%”. */
export function prepareProgressText(fraction: number): string {
  const pct = Math.min(100, Math.max(0, Math.floor((Number.isFinite(fraction) ? fraction : 0) * 100)));
  return `Otimizando o vídeo… ${pct}%`;
}
