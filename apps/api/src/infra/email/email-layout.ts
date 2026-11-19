/**
 * Layout padrão dos e-mails do AskouT: faixa noturna com o logo, filete no degradê da marca, cartão branco
 * e rodapé com o endereço do site. Tudo em tabelas e estilos inline, que é o que Gmail, Outlook e Apple Mail entendem.
 * As cores são as mesmas do app (apps/web/src/styles.css).
 */

export const BRAND = {
  /** Fundo da entrada do app (visual noturno). */
  night: '#080620',
  pink: '#fa72c9',
  purple: '#b56efc',
  /** Rosa mais fechado para texto sobre fundo claro (passa de 4.5:1). */
  pinkText: '#c2187f',
  pinkSoft: '#fde8f5',
  bg: '#f2f2f7',
  surface: '#ffffff',
  ink: '#1c1c1e',
  muted: '#5c5c60',
  line: '#e5e5ea',
} as const;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface LayoutBrand {
  /** Endereço do site, sem barra no fim (ex.: https://askout.com.br). */
  siteUrl: string;
  /** Imagem do logo usada no topo (absoluta; padrão: `${siteUrl}/email/logo.png`). */
  logoUrl?: string;
}

/** Pedaços do corpo do e-mail, já no estilo da marca. O texto entra sempre escapado. */
export const block = {
  title: (text: string): string => `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${BRAND.ink}">${escapeHtml(text)}</h1>`,
  paragraph: (text: string): string => `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${BRAND.ink}">${escapeHtml(text)}</p>`,
  note: (text: string): string => `<p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.5;color:${BRAND.muted}">${escapeHtml(text)}</p>`,
  /** Código em destaque, em caixa rosa clara. */
  code: (code: string): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr><td align="center" style="padding:20px 12px;background:${BRAND.pinkSoft};border-radius:14px;font-family:${FONT};font-size:34px;line-height:1;font-weight:700;letter-spacing:8px;color:${BRAND.pinkText}">${escapeHtml(code)}</td></tr></table>`,
  /** Botão rosa com texto escuro (mesmo contraste do app). */
  button: (label: string, href: string): string =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px"><tr><td align="center" bgcolor="${BRAND.pink}" style="border-radius:12px;background:${BRAND.pink}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:16px;font-weight:700;color:#15162a;text-decoration:none;border-radius:12px">${escapeHtml(label)}</a></td></tr></table>`,
};

export interface LayoutInput {
  /** Título da aba / assunto, só para o <title>. */
  subject: string;
  /** Linha que aparece ao lado do assunto na caixa de entrada (fica escondida no corpo). */
  preheader: string;
  /** Corpo já montado com `block.*`. */
  body: string;
  /** Aviso final em letra miúda (ex.: "Se não foi você, ignore este e-mail"). */
  footer: string;
}

export function renderEmail(brand: LayoutBrand, input: LayoutInput): string {
  const site = brand.siteUrl.replace(/\/+$/, '');
  const logo = brand.logoUrl ?? `${site}/email/logo.png`;
  const siteLabel = site.replace(/^https?:\/\//, '');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(input.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.bg}" style="background:${BRAND.bg}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;border-radius:20px;overflow:hidden;background:${BRAND.surface}">
<tr><td align="center" bgcolor="${BRAND.night}" style="padding:28px 24px 24px;background:${BRAND.night}">
<a href="${escapeHtml(site)}" style="text-decoration:none"><img src="${escapeHtml(logo)}" width="56" height="56" alt="AskouT" style="display:block;margin:0 auto 10px;border:0;width:56px;height:56px;border-radius:14px"></a>
<div style="font-family:${FONT};font-size:22px;line-height:1;font-weight:700;letter-spacing:-0.5px;color:#ffffff">AskouT</div>
</td></tr>
<tr><td height="4" bgcolor="${BRAND.pink}" style="height:4px;line-height:4px;font-size:0;background:${BRAND.pink};background-image:linear-gradient(90deg,${BRAND.purple},${BRAND.pink})">&nbsp;</td></tr>
<tr><td style="padding:32px 28px 12px">
${input.body}
</td></tr>
<tr><td style="padding:0 28px 28px">
<div style="border-top:1px solid ${BRAND.line};padding-top:16px;font-family:${FONT};font-size:13px;line-height:1.5;color:${BRAND.muted}">${escapeHtml(input.footer)}</div>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
<tr><td align="center" style="padding:18px 12px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${BRAND.muted}">
<a href="${escapeHtml(site)}" style="color:${BRAND.pinkText};font-weight:600;text-decoration:none">${escapeHtml(siteLabel)}</a><br>
Menos tempo combinando. Mais tempo juntos.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Versão em texto puro, com a mesma assinatura em todos os e-mails. */
export function renderText(brand: LayoutBrand, parts: string[], footer: string): string {
  const site = brand.siteUrl.replace(/\/+$/, '');
  return `${parts.join('\n\n')}\n\n${footer}\n\n—\nAskouT\n${site}`;
}
