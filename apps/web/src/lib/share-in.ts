/**
 * "Compartilhar com o AskouT" vindo de outro app (Galeria, Arquivos, navegador...). A casca nativa recebe o
 * compartilhamento e guarda os arquivos no cache do app (ponte `window.AskouTShareIn`, ver apps/mobile/src/main.ts);
 * aqui eles viram `File` e esperam a tela "Enviar para…" (/compartilhar).
 */
import { mediaKind } from './chat-media.ts';
import { documentType } from './chat-file.ts';

export interface SharedItemRef {
  /** Caminho do arquivo no aparelho (`file://...`), lido pelo servidor local do app. */
  path: string;
  name: string;
  mime: string;
}

export interface IncomingShareRaw {
  items: SharedItemRef[];
  text?: string | null;
}

export interface ShareInBridge {
  /** Pega (e esquece) o compartilhamento que abriu o app, se houver. */
  take(): Promise<IncomingShareRaw | null>;
  /** Compartilhamento novo com o app já aberto. Devolve a função que para de escutar. */
  onShare(cb: () => void): () => void;
}

export interface IncomingShare {
  files: File[];
  text: string;
}

export const SHARE_IN_EVENT = 'askout:share-in';
/** Quantos arquivos de uma vez (como a seleção de fotos do chat). */
export const SHARE_IN_MAX_FILES = 10;

let pending: IncomingShare | undefined;

export function shareInBridge(host: unknown = typeof window === 'undefined' ? undefined : window): ShareInBridge | undefined {
  const b = (host as { AskouTShareIn?: Partial<ShareInBridge> } | undefined)?.AskouTShareIn;
  return b && typeof b.take === 'function' && typeof b.onShare === 'function' ? (b as ShareInBridge) : undefined;
}

export function setIncomingShare(share: IncomingShare | undefined): void {
  pending = share;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SHARE_IN_EVENT));
}

export function peekIncomingShare(): IncomingShare | undefined {
  return pending;
}

/** O que dá para mandar no chat: foto, vídeo ou documento. */
export type ShareKind = 'IMAGE' | 'VIDEO' | 'FILE';

export function shareKind(file: { name: string; type: string }): ShareKind | undefined {
  const media = mediaKind(file);
  if (media === 'IMAGE' || media === 'VIDEO') return media;
  return documentType(file.name, file.type) ? 'FILE' : undefined;
}

/** Texto compartilhado (link de uma página, por exemplo), limpo e com no máximo 2000 letras. */
export function cleanSharedText(text: string | null | undefined): string {
  return Array.from((text ?? '').trim()).slice(0, 2000).join('');
}

/** Lê os arquivos que a casca guardou e deixa o compartilhamento esperando a tela "Enviar para…". */
export async function loadIncomingShare(raw: IncomingShareRaw, read: (path: string) => Promise<Blob>): Promise<IncomingShare> {
  const files: File[] = [];
  for (const item of raw.items.slice(0, SHARE_IN_MAX_FILES)) {
    const blob = await read(item.path);
    files.push(new File([blob], item.name || 'arquivo', { type: item.mime || blob.type }));
  }
  return { files, text: cleanSharedText(raw.text) };
}
