// Baixar fotos (álbum do evento, posts) para o aparelho.
// No app nativo, a ponte `window.AskouTFiles` (apps/mobile/src/files-bridge.ts) abre o menu com "Salvar imagem".
// No navegador do celular, o menu de compartilhar com os arquivos (também tem "Salvar imagem"); no computador, download comum.

export interface ImageToSave {
  blob: Blob;
  /** Nome sem extensão; a extensão vem do tipo da imagem. */
  name: string;
}

interface FilesBridge {
  saveImages(o: { files: { filename: string; base64: string }[] }): Promise<void>;
  openDocument(o: { filename: string; base64: string }): Promise<void>;
}

interface SaveEnv {
  AskouTFiles?: Partial<FilesBridge>;
  navigator?: { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void>; maxTouchPoints?: number };
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' };

/** "askout-samba-no-bar-3.jpg": só letras simples, para servir em qualquer sistema (e passar na ponte nativa). */
export function imageFileName(name: string, type: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'foto'}.${EXT[type.split(';')[0]!.trim().toLowerCase()] ?? 'jpg'}`;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function isCancel(failure: unknown): boolean {
  return failure instanceof Error && (failure.name === 'AbortError' || /cancel|dismiss/i.test(failure.message));
}

function downloadOne(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nome que serve em qualquer sistema (e passa na ponte nativa): letras simples, mantendo a extensão. */
export function documentFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : '';
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 80);
  return `${base || 'arquivo'}${ext ? `.${ext}` : ''}`;
}

/**
 * Abre um documento recebido na conversa. No app: grava no aparelho e abre o menu "Abrir com" (leitor de PDF, Drive,
 * salvar em Arquivos...). No navegador: baixa com o nome original.
 */
export async function openDocument(blob: Blob, name: string, env: SaveEnv = globalThis as never): Promise<void> {
  const bridge = env.AskouTFiles;
  if (typeof bridge?.openDocument === 'function') {
    await bridge.openDocument({ filename: documentFileName(name), base64: await toBase64(blob) });
    return;
  }
  downloadOne(blob, name);
}

/** Salva as imagens. Devolve false se a pessoa fechou o menu sem salvar. */
export async function saveImages(images: ImageToSave[], env: SaveEnv = globalThis as never): Promise<boolean> {
  if (images.length === 0) return false;
  const named = images.map((image) => ({ blob: image.blob, filename: imageFileName(image.name, image.blob.type) }));
  // Nomes repetidos sobrescreveriam um ao outro no cache do app.
  const seen = new Map<string, number>();
  for (const item of named) {
    const n = (seen.get(item.filename) ?? 0) + 1;
    seen.set(item.filename, n);
    if (n > 1) item.filename = item.filename.replace(/(\.[a-z]+)$/, `-${n}$1`);
  }

  const bridge = env.AskouTFiles;
  if (typeof bridge?.saveImages === 'function') {
    const files = await Promise.all(named.map(async (item) => ({ filename: item.filename, base64: await toBase64(item.blob) })));
    await bridge.saveImages({ files });
    return true;
  }

  // Celular no navegador: o menu de compartilhar com as fotos tem "Salvar imagem" (o download comum cai em Arquivos).
  const nav = env.navigator;
  const touch = (nav?.maxTouchPoints ?? 0) > 0;
  if (touch && typeof nav?.share === 'function' && typeof File !== 'undefined') {
    const files = named.map((item) => new File([item.blob], item.filename, { type: item.blob.type || 'image/jpeg' }));
    if (nav.canShare?.({ files }) ?? false) {
      try {
        await nav.share({ files });
        return true;
      } catch (failure) {
        if (isCancel(failure)) return false;
        // Sem permissão para compartilhar (ex.: fora do toque): segue para o download comum.
      }
    }
  }

  for (const [i, item] of named.entries()) {
    if (i > 0) await wait(300); // vários downloads seguidos: o navegador bloqueia se vierem de uma vez
    downloadOne(item.blob, item.filename);
  }
  return true;
}

/** Busca a imagem já mostrada na tela (endereço blob:, data: ou da API) para salvar. */
export async function fetchImage(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}
