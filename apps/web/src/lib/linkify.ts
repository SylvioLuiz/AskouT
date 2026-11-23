/**
 * Links no texto das mensagens, como no WhatsApp: http(s)://..., www.... e endereços como "askout.com.br/evento/x"
 * ou "instagram.com/whatsbar_". A pontuação do fim da frase ("veja isso: site.com.br.") fica fora do link.
 */
export interface TextPart {
  text: string;
  /** Endereço completo (com https://) quando o trecho é um link. */
  href?: string;
}

const TLDS = 'com|br|net|org|app|io|me|ly|gl|co|info|dev|tv|gg|link|site|online|store|shop|xyz|art|bar|club|events|fm|la|to|us|uk|pt|es|ar|mx';
const URL_RE = new RegExp(
  String.raw`(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${TLDS})(?![a-z0-9-])(?:[\/?#][^\s<>"]*)?)`,
  'gi',
);
/** Pontuação que encerra a frase e não faz parte do link. */
const TRAILING = /[.,!?;:'"’”…]+$/;

function trim(url: string): string {
  let out = url.replace(TRAILING, '');
  // Parêntese de fechamento sem o de abertura no link: é da frase ("(veja site.com)").
  while (out.endsWith(')') && (out.match(/\(/g) ?? []).length < (out.match(/\)/g) ?? []).length) out = out.slice(0, -1).replace(TRAILING, '');
  return out;
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const url = trim(raw);
    if (url === '' || !/\.[a-z]{2,}/i.test(url)) continue;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: /^https?:\/\//i.test(url) ? url : `https://${url}` });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.length > 0 ? parts : [{ text }];
}

/** Link do próprio AskouT (askout.com.br): abre dentro do app, no caminho dele. Outros: `undefined`. */
export function inAppPath(href: string, hosts: readonly string[] = ['askout.com.br', 'www.askout.com.br']): string | undefined {
  try {
    const url = new URL(href);
    if (!hosts.includes(url.hostname.toLowerCase())) return undefined;
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return undefined;
  }
}
