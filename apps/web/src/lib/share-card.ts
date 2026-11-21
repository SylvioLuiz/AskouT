// Cartão pronto para postar em outra rede (Instagram Feed/Stories, WhatsApp Status, TikTok...):
// uma imagem 1080×1920 com a capa, o título, quando e onde, e a legenda já escrita (copiada para colar).
// No app nativo a imagem vai pela ponte `window.AskouTFiles.shareImage` (apps/mobile/src/files-bridge.ts);
// no celular pelo navigator.share com arquivo; no computador, baixa a imagem.
import { imageFileName } from './save-file.ts';
import { t } from './i18n/index.ts';

export interface ShareCard {
  /** Selo acima do título: "EVENTO", "POST". */
  kicker: string;
  title: string;
  /** Linhas curtas embaixo do título: quando, onde, quem postou. */
  lines: string[];
  /** Capa (endereço já pronto para buscar). Sem capa, o fundo é o degradê da marca. */
  imageUrl?: string | null;
  url: string;
  /** Legenda pronta, copiada na hora de compartilhar. */
  caption: string;
  /** Base do nome do arquivo (sem extensão). */
  name: string;
}

export const CARD_W = 1080;
export const CARD_H = 1920;
const CAPTION_MAX = 2200; // limite da legenda do Instagram

/** Legenda no formato dos posts de rede social: título, quando/onde, convite com o link e as hashtags. */
export function cardCaption(o: { title: string; lines: readonly string[]; url: string; invite: string; tags?: readonly string[] }): string {
  const body = [o.title.trim(), ...o.lines.map((line) => line.trim()).filter(Boolean)].filter(Boolean).join('\n');
  const tags = ['askout', ...(o.tags ?? [])].map(hashtag).filter(Boolean);
  const unique = [...new Set(tags)].map((tag) => `#${tag}`).join(' ');
  return `${body}\n\n${o.invite} ${o.url}\n\n${unique}`.slice(0, CAPTION_MAX);
}

/** "Samba de Roda" → "sambaderoda": hashtag sem acento nem espaço (o Instagram corta no primeiro símbolo). */
export function hashtag(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);
}

/** "askout.app/eventos/abc": o link sem https:// e sem barra no fim, para caber no cartão. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Quebra o texto em linhas que cabem na largura, no máximo `max` linhas (a última ganha "…" se sobrar texto).
 * `measure` devolve a largura do texto (no canvas, `ctx.measureText(text).width`).
 */
export function wrapText(text: string, measure: (text: string) => number, width: number, max: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let truncated = false;
  outer: for (const original of words) {
    // Palavra que sozinha não cabe (link, nome comprido): vira pedaços.
    const chunks: string[] = [];
    let word = original;
    while (measure(word) > width && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && measure(word.slice(0, cut)) > width) cut--;
      chunks.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    chunks.push(word);
    for (const chunk of chunks) {
      const next = line ? `${line} ${chunk}` : chunk;
      if (measure(next) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = chunk;
      if (lines.length === max) {
        truncated = true;
        break outer;
      }
    }
  }
  if (!truncated && line) lines.push(line);
  if (truncated) {
    let last = lines[lines.length - 1]!;
    while (last.length > 1 && measure(`${last}…`) > width) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BRAND = '#fa72c9';
const INK = '#15162a';

async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    // Busca como arquivo (e não <img crossorigin>) para o canvas não ficar "sujo" e poder virar imagem.
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Desenha o cartão 1080×1920 (tamanho do Stories; no Feed o Instagram recorta o centro). */
export async function renderShareCard(card: ShareCard): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  const pad = 88;
  const width = CARD_W - pad * 2;

  const image = card.imageUrl ? await loadImage(card.imageUrl) : null;
  if (image) {
    // Capa preenchendo tudo, centralizada (como object-fit: cover).
    const scale = Math.max(CARD_W / image.width, CARD_H / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
    image.close();
  } else {
    const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    bg.addColorStop(0, INK);
    bg.addColorStop(0.55, '#4a2350');
    bg.addColorStop(1, BRAND);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  // Sombra em cima (marca) e embaixo (texto) para ler sobre qualquer foto.
  const top = ctx.createLinearGradient(0, 0, 0, 360);
  top.addColorStop(0, 'rgba(0,0,0,0.55)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_W, 360);
  const bottom = ctx.createLinearGradient(0, CARD_H * 0.38, 0, CARD_H);
  bottom.addColorStop(0, 'rgba(10,10,20,0)');
  bottom.addColorStop(0.45, 'rgba(10,10,20,0.72)');
  bottom.addColorStop(1, 'rgba(10,10,20,0.94)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, CARD_H * 0.38, CARD_W, CARD_H * 0.62);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `800 60px ${FONT}`;
  ctx.fillText('AskouT', pad, 170);

  // Rodapé: pílula com o link (no Stories a pessoa põe o adesivo de link por cima).
  const footY = CARD_H - 150;
  ctx.font = `600 38px ${FONT}`;
  const link = wrapText(shortUrl(card.url), (s) => ctx.measureText(s).width, width - 80, 1)[0] ?? '';
  const pillW = Math.min(width, ctx.measureText(link).width + 80);
  roundRect(ctx, pad, footY - 62, pillW, 92, 46);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(link, pad + 40, footY);

  // Texto de baixo para cima: linhas, título, selo.
  let y = footY - 130;
  ctx.font = `500 44px ${FONT}`;
  const detail = card.lines.flatMap((line) => wrapText(line, (s) => ctx.measureText(s).width, width, 2)).slice(-5);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  for (let i = detail.length - 1; i >= 0; i--) {
    ctx.fillText(detail[i]!, pad, y);
    y -= 62;
  }
  y -= 30;
  ctx.font = `800 96px ${FONT}`;
  const title = wrapText(card.title, (s) => ctx.measureText(s).width, width, 4);
  ctx.fillStyle = '#fff';
  for (let i = title.length - 1; i >= 0; i--) {
    ctx.fillText(title[i]!, pad, y);
    y -= 108;
  }
  if (card.kicker) {
    ctx.font = `800 34px ${FONT}`;
    const kick = card.kicker.toUpperCase();
    const kw = ctx.measureText(kick).width + 56;
    const ky = y - 30;
    roundRect(ctx, pad, ky - 44, kw, 64, 32);
    ctx.fillStyle = BRAND;
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(kick, pad + 28, ky);
  }

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas-empty'))), 'image/png'));
}

interface CardEnv {
  AskouTFiles?: { shareImage?: (o: { filename: string; base64: string; text?: string }) => Promise<boolean>; saveImages?: (o: { files: { filename: string; base64: string }[] }) => Promise<void> };
  navigator?: { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void>; maxTouchPoints?: number };
}

/** 'shared' = abriu o menu e a pessoa escolheu; 'saved' = baixou a imagem (computador); 'cancelled' = fechou o menu. */
export type CardResult = 'shared' | 'saved' | 'cancelled';

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function isCancel(failure: unknown): boolean {
  return failure instanceof Error && (failure.name === 'AbortError' || /cancel|dismiss/i.test(failure.message));
}

/** Abre o menu do aparelho com a imagem (Instagram, WhatsApp...) ou, no computador, baixa a imagem. */
export async function shareCardImage(blob: Blob, name: string, caption: string, env: CardEnv = globalThis as never): Promise<CardResult> {
  const filename = imageFileName(name, blob.type || 'image/png');
  const bridge = env.AskouTFiles;
  if (typeof bridge?.shareImage === 'function') {
    return (await bridge.shareImage({ filename, base64: await toBase64(blob), text: caption })) ? 'shared' : 'cancelled';
  }
  if (typeof bridge?.saveImages === 'function') {
    // Versão antiga do app (sem shareImage): o menu de salvar foto também lista o Instagram.
    await bridge.saveImages({ files: [{ filename, base64: await toBase64(blob) }] });
    return 'shared';
  }
  const nav = env.navigator;
  if (typeof nav?.share === 'function' && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
    // Sem `text`: vários apps (Instagram incluso) recusam arquivo + texto juntos. A legenda já foi copiada.
    if (nav.canShare?.({ files: [file] }) ?? false) {
      try {
        await nav.share({ files: [file] });
        return 'shared';
      } catch (failure) {
        if (isCancel(failure)) return 'cancelled';
        // Sem permissão (ex.: o toque "expirou" enquanto a imagem era montada): baixa a imagem.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/** Convite no fim da legenda. */
export function cardInvite(kind: 'event' | 'post'): string {
  return kind === 'event' ? t('Bora? Confirma presença no AskouT:') : t('Vem ver no AskouT:');
}
