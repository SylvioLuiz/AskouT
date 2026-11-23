/**
 * Aviso na aba do navegador, como no WhatsApp Web: com mensagem nova, o título ganha o número na frente
 * ("(2) Conversas · AskouT") e o ícone da aba ganha uma bolinha. Some quando não há mais nada para ler.
 */

/** Título com o número de conversas com mensagem nova na frente. */
export function tabTitle(base: string, count: number): string {
  if (count <= 0) return base;
  return `(${count > 99 ? '99+' : count}) ${base}`;
}

let base = typeof document === 'undefined' ? 'AskouT' : document.title || 'AskouT';
let count = 0;

function apply(): void {
  if (typeof document === 'undefined') return;
  const next = tabTitle(base, count);
  if (document.title !== next) document.title = next;
}

/** Título da tela (sem o número); quem chama é o useTitle. */
export function setBaseTitle(title: string): void {
  base = title;
  apply();
}

const ICON = '/favicon.png';
let dotted: string | undefined;
let drawing: Promise<string | undefined> | undefined;

/** Ícone da aba com uma bolinha rosa no canto (desenhado uma vez e guardado). */
function dottedIcon(): Promise<string | undefined> {
  if (dotted) return Promise.resolve(dotted);
  drawing ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(undefined);
        ctx.drawImage(img, 0, 0, size, size);
        const r = size * 0.2;
        ctx.beginPath();
        ctx.arc(size - r - 2, r + 2, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(size - r - 2, r + 2, r, 0, Math.PI * 2);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || 'deeppink';
        ctx.fill();
        dotted = canvas.toDataURL('image/png');
        resolve(dotted);
      } catch {
        resolve(undefined);
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = ICON;
  });
  return drawing;
}

function setIcon(href: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/** Número de conversas com mensagem nova: atualiza o título e o ícone da aba. */
export function setTabBadge(next: number): void {
  if (typeof document === 'undefined' || next === count) return;
  count = Math.max(0, next);
  apply();
  if (count === 0) {
    setIcon(ICON);
    return;
  }
  void dottedIcon().then((href) => {
    if (href && count > 0) setIcon(href);
  });
}
