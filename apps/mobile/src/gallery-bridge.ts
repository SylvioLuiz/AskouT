/**
 * Ponte `window.AskouTGallery`: a galeria do aparelho dentro do app, para a tela de criar story (estilo Instagram).
 * Hoje só no iPhone (plugin nativo GalleryPlugin.swift). No Android o app segue com o seletor do sistema, porque a
 * política do Google Play recusa o acesso à galeria inteira quando o seletor basta (ver AndroidManifest.xml).
 * Contrato do lado web: apps/web/src/lib/gallery.ts.
 */

export type GalleryAccess = 'full' | 'limited' | 'denied' | 'prompt';

export interface GalleryItem {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  thumb: string;
  seconds?: number;
}

export interface GalleryPluginLike {
  access(): Promise<{ access: string }>;
  request(): Promise<{ access: string }>;
  recent(o: { offset: number; limit: number; thumbSize?: number }): Promise<{ items: GalleryItem[]; more: boolean }>;
  file(o: { id: string }): Promise<{ path: string; mime: string; name: string }>;
  discard(o: { path: string }): Promise<void>;
  manage(): Promise<void>;
  openSettings(): Promise<void>;
}

export interface GalleryBridgeDeps {
  plugin: GalleryPluginLike;
  /** Endereço que o WebView consegue ler para um arquivo do aparelho. */
  convertFileSrc(path: string): string;
  fetchFile(url: string): Promise<Blob>;
  /** Densidade da tela, para a miniatura sair nítida sem pesar. */
  pixelRatio(): number;
}

function toAccess(value: string | undefined): GalleryAccess {
  return value === 'full' || value === 'limited' || value === 'prompt' ? value : 'denied';
}

export function createGalleryBridge(deps: GalleryBridgeDeps) {
  return {
    async access(): Promise<GalleryAccess> {
      return toAccess((await deps.plugin.access()).access);
    },
    async request(): Promise<GalleryAccess> {
      return toAccess((await deps.plugin.request()).access);
    },
    async recent(o: { offset: number; limit: number }): Promise<{ items: GalleryItem[]; more: boolean }> {
      // Três colunas na largura do celular: cada miniatura tem ~1/3 da tela.
      const thumbSize = Math.round(Math.min(600, Math.max(120, (globalThis.innerWidth || 390) / 3) * Math.min(3, Math.max(1, deps.pixelRatio()))));
      const page = await deps.plugin.recent({ offset: o.offset, limit: o.limit, thumbSize });
      return { items: page.items.filter((i) => i.id && i.thumb), more: page.more };
    },
    async file(id: string): Promise<File> {
      const out = await deps.plugin.file({ id });
      try {
        const blob = await deps.fetchFile(deps.convertFileSrc(out.path));
        if (blob.size === 0) throw new Error('Não foi possível abrir esta mídia.');
        return new File([blob], out.name, { type: out.mime });
      } finally {
        await deps.plugin.discard({ path: out.path }).catch(() => undefined);
      }
    },
    manage: () => deps.plugin.manage(),
    openSettings: () => deps.plugin.openSettings(),
  };
}
