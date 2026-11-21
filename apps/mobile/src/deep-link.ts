/**
 * Links que abrem o app: `br.com.askout://…` (volta do login da Google Agenda / Outlook no navegador; convite pelo
 * `intent://` do Android) e `https://askout.com.br/…` (Universal Link do iPhone / App Link do Android).
 * Só caminhos conhecidos viram rota do app; o resto é ignorado.
 */
const ALLOWED = new Set(['/agenda']);
/** Convite: `/convite/usuario` (o app leva ao cadastro ou ao perfil de quem convidou). */
const INVITE = /^\/convite\/[a-z0-9._]{3,30}$/i;
const WEB_HOSTS = new Set(['askout.com.br', 'www.askout.com.br']);

export function deepLinkPath(url: string): string | undefined {
  let rawPath: string;
  let query: string;
  const custom = /^br\.com\.askout:\/\/([^?#]*)(\?[^#]*)?/.exec(url);
  if (custom) {
    rawPath = custom[1] ?? '';
    query = custom[2] ?? '';
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== 'https:' || !WEB_HOSTS.has(parsed.hostname)) return undefined;
    rawPath = parsed.pathname;
    query = parsed.search;
  }
  const path = `/${rawPath.replace(/^\/+|\/+$/g, '')}`;
  if (INVITE.test(path)) return path;
  if (!ALLOWED.has(path)) return undefined;
  return path + query;
}
