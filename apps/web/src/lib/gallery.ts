/**
 * Galeria do aparelho dentro do app (como no Instagram): grade com as fotos e vídeos mais recentes.
 * Só existe quando a casca nativa oferece `window.AskouTGallery` (hoje, no iPhone). Sem ela, o app usa o seletor do sistema.
 */

/** `full`: todas as fotos. `limited`: só as que a pessoa escolheu (iOS). `prompt`: ainda não perguntou. */
export type GalleryAccess = 'full' | 'limited' | 'denied' | 'prompt';

export interface GalleryItem {
  /** Identificador da mídia no aparelho. */
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  /** Miniatura pronta para <img> (data: URL ou endereço local). */
  thumb: string;
  /** Duração, só nos vídeos. */
  seconds?: number;
}

export interface NativeGallery {
  access(): Promise<GalleryAccess>;
  /** Pede acesso às fotos (mostra o pedido do sistema só na primeira vez). */
  request(): Promise<GalleryAccess>;
  /** Mídias da mais nova para a mais antiga. */
  recent(options: { offset: number; limit: number }): Promise<{ items: GalleryItem[]; more: boolean }>;
  /** O arquivo inteiro da mídia, pronto para enviar (foto em JPEG, vídeo em MP4). */
  file(id: string): Promise<File>;
  /** Acesso limitado: abre a escolha de quais fotos o app vê. */
  manage(): Promise<void>;
  /** Abre os Ajustes do app (quando a pessoa negou o acesso). */
  openSettings(): Promise<void>;
}

export function nativeGallery(env: { AskouTGallery?: Partial<NativeGallery> } = globalThis as never): NativeGallery | undefined {
  const g = env.AskouTGallery;
  if (!g) return undefined;
  const methods: (keyof NativeGallery)[] = ['access', 'request', 'recent', 'file', 'manage', 'openSettings'];
  return methods.every((m) => typeof g[m] === 'function') ? (g as NativeGallery) : undefined;
}

/** "0:07", "1:32": duração no canto da miniatura do vídeo. */
export function durationLabel(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Altura do texto do story na tela: entre 10% e 90%, para nunca ficar sob o topo ou o rodapé. */
export function clampCaptionY(y: number): number {
  if (!Number.isFinite(y)) return 0.5;
  return Math.min(0.9, Math.max(0.1, y));
}
