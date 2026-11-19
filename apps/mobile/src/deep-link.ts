/**
 * Endereços `br.com.askout://…` que abrem o app (por exemplo, a volta do login da Google Agenda ou do Outlook no navegador).
 * Só caminhos conhecidos viram rota do app; o resto é ignorado.
 */
const ALLOWED = new Set(['/agenda']);

export function deepLinkPath(url: string): string | undefined {
  const match = /^br\.com\.askout:\/\/([^?#]*)(\?[^#]*)?/.exec(url);
  if (!match) return undefined;
  const path = `/${(match[1] ?? '').replace(/^\/+|\/+$/g, '')}`;
  if (!ALLOWED.has(path)) return undefined;
  return path + (match[2] ?? '');
}
