/**
 * Ponte `window.AskouTVideo`: o app web entrega o arquivo escolhido e recebe de volta o vídeo comprimido.
 * O plugin nativo trabalha com arquivos do aparelho, então o arquivo é gravado no cache (em pedaços, sem carregar
 * tudo na memória), comprimido, lido de volta e os temporários são apagados.
 */

export interface FilesystemLike {
  writeFile(o: { path: string; data: string; directory: 'CACHE' }): Promise<{ uri: string }>;
  appendFile(o: { path: string; data: string; directory: 'CACHE' }): Promise<unknown>;
  deleteFile(o: { path: string; directory?: 'CACHE' }): Promise<unknown>;
}

export interface CompressorLike {
  compressVideo(o: { sourcePath: string; quality: Quality; jobId?: string }): Promise<{ success: boolean; destPath: string }>;
  addListener(event: 'onProgress', fn: (info: { status: string; percent?: number }) => void): Promise<{ remove(): Promise<void> | void }>;
}

export type Quality = 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface VideoBridgeDeps {
  filesystem: FilesystemLike;
  compressor: CompressorLike;
  /** Endereço que o WebView consegue ler para um arquivo do aparelho. */
  convertFileSrc(path: string): string;
  fetchFile(url: string): Promise<Blob>;
  /** Base64 puro (sem o prefixo “data:”) de um pedaço do arquivo. */
  toBase64(chunk: Blob): Promise<string>;
  newId(): string;
}

export interface CompressOptions {
  maxEdge: number;
  videoBitsPerSecond: number;
  onProgress?: (fraction: number) => void;
}

/** Pedaço múltiplo de 3 bytes: base64 de cada pedaço pode ser concatenado sem erro. */
export const CHUNK_BYTES = 3 * 1024 * 1024;

/** O plugin só oferece degraus de qualidade; escolhe o que mais se aproxima do lado maior pedido. */
export function qualityFor(maxEdge: number): Quality {
  if (maxEdge >= 1800) return 'VERY_HIGH';
  if (maxEdge >= 1100) return 'HIGH'; // ≈ 720p
  if (maxEdge >= 800) return 'MEDIUM';
  return 'LOW';
}

function extensionOf(name: string): string {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(name);
  return match?.[1]?.toLowerCase() ?? 'mp4';
}

export function createVideoBridge(deps: VideoBridgeDeps) {
  return {
    async compress(file: File, options: CompressOptions): Promise<File | undefined> {
      const id = deps.newId();
      const sourceName = `askout-in-${id}.${extensionOf(file.name)}`;
      let destPath: string | undefined;
      let listener: { remove(): Promise<void> | void } | undefined;
      try {
        let sourceUri = '';
        for (let offset = 0, first = true; offset < file.size || first; offset += CHUNK_BYTES, first = false) {
          const data = await deps.toBase64(file.slice(offset, offset + CHUNK_BYTES));
          if (first) sourceUri = (await deps.filesystem.writeFile({ path: sourceName, data, directory: 'CACHE' })).uri;
          else await deps.filesystem.appendFile({ path: sourceName, data, directory: 'CACHE' });
        }
        if (options.onProgress) {
          const report = options.onProgress;
          listener = await deps.compressor.addListener('onProgress', (info) => {
            if (typeof info.percent === 'number') report(Math.min(1, Math.max(0, info.percent / 100)));
          });
        }
        const result = await deps.compressor.compressVideo({ sourcePath: sourceUri, quality: qualityFor(options.maxEdge), jobId: id });
        if (!result.success || !result.destPath) return undefined;
        destPath = result.destPath;
        const blob = await deps.fetchFile(deps.convertFileSrc(destPath));
        if (blob.size === 0) return undefined;
        const base = file.name.replace(/\.[^./\\]+$/, '') || 'video';
        return new File([blob], `${base}.mp4`, { type: 'video/mp4' });
      } finally {
        await Promise.resolve(listener?.remove()).catch(() => undefined);
        await deps.filesystem.deleteFile({ path: sourceName, directory: 'CACHE' }).catch(() => undefined);
        if (destPath) await deps.filesystem.deleteFile({ path: destPath }).catch(() => undefined);
      }
    },
  };
}
