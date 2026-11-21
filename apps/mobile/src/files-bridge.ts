/**
 * Ponte `window.AskouTFiles`: salvar fotos no aparelho (álbum do evento, fotos de post).
 * O WebView não baixa arquivos sozinho: grava as fotos no cache do app e abre o menu de compartilhar,
 * que no iPhone tem "Salvar imagem(ns)" e no Android "Salvar na galeria" / Fotos / Arquivos.
 * Contrato do lado web: apps/web/src/lib/save-file.ts.
 */

export interface FilesDeps {
  /** Grava o conteúdo (base64) em arquivo temporário e devolve o endereço (`file://`) dele. */
  writeFile(o: { path: string; data: string }): Promise<{ uri: string }>;
  share(o: { files: string[]; dialogTitle: string; text?: string }): Promise<unknown>;
}

const NAME = /^[A-Za-z0-9._-]{1,80}\.(jpe?g|png|webp|gif|heic)$/i;
const MAX_FILES = 50;
const TEXT_MAX = 2200; // limite da legenda do Instagram

function isCancel(e: unknown): boolean {
  // Fechar o menu sem escolher lança erro em alguns aparelhos: não é falha.
  const text = e instanceof Error ? e.message : String(e);
  return /cancel|dismiss/i.test(text);
}

export function createFilesBridge(deps: FilesDeps) {
  return {
    async saveImages(o: { files: { filename: string; base64: string }[] }): Promise<void> {
      if (!Array.isArray(o.files) || o.files.length === 0 || o.files.length > MAX_FILES) throw new Error('Nada para salvar.');
      for (const f of o.files) if (!NAME.test(f.filename) || !f.base64) throw new Error('Arquivo inválido.');
      const uris: string[] = [];
      for (const f of o.files) uris.push((await deps.writeFile({ path: f.filename, data: f.base64 })).uri);
      try {
        await deps.share({ files: uris, dialogTitle: o.files.length === 1 ? 'Salvar foto' : 'Salvar fotos' });
      } catch (e) {
        if (isCancel(e)) return;
        throw e;
      }
    },
    /**
     * Compartilhar um cartão pronto (imagem do evento/post) em outra rede: Instagram (Feed, Stories, Direct), WhatsApp...
     * Devolve false se a pessoa fechou o menu sem escolher.
     */
    async shareImage(o: { filename: string; base64: string; text?: string }): Promise<boolean> {
      if (!NAME.test(o.filename) || !o.base64) throw new Error('Arquivo inválido.');
      const { uri } = await deps.writeFile({ path: o.filename, data: o.base64 });
      const text = typeof o.text === 'string' ? o.text.slice(0, TEXT_MAX) : undefined;
      try {
        await deps.share({ files: [uri], dialogTitle: 'Compartilhar', ...(text ? { text } : {}) });
        return true;
      } catch (e) {
        if (isCancel(e)) return false;
        throw e;
      }
    },
  };
}
