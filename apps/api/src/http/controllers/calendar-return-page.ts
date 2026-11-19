const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Endereço que abre o app (esquema registrado no Android e no iPhone) direto na Agenda, com a folha de agendas e o aviso. */
export function appReturnUrl(provider: 'GOOGLE' | 'MICROSOFT', ok: boolean, message: string | undefined): string {
  const q = new URLSearchParams(ok ? { agendas: provider.toLowerCase() } : { agendas: 'erro', motivo: message ?? '' });
  return `br.com.askout://agenda?${q.toString()}`;
}

/**
 * Página para quem ligou uma agenda pelo app: o login abriu no navegador do celular. Ela já tenta abrir o app
 * na Agenda (onde aparece o aviso com o check) e deixa um botão, caso o navegador peça um toque antes.
 */
export function backToAppPage(ok: boolean, name: string, message: string | undefined, appUrl: string): string {
  const title = ok ? `${name} ligada` : 'Não deu certo';
  const text = ok ? 'Pronto! Voltando ao AskouT…' : message ?? 'Tente de novo pelo app.';
  const href = escapeHtml(appUrl);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;background:#fff;color:#1d1d1f;text-align:center}@media(prefers-color-scheme:dark){body{background:#111;color:#f5f5f7}}h1{font-size:1.4rem}p{max-width:22rem;line-height:1.5}a.btn{display:inline-block;margin-top:8px;padding:14px 28px;border-radius:999px;background:#c2187f;color:#fff;font-weight:700;text-decoration:none}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><a class="btn" href="${href}">Abrir o AskouT</a></main>
<script>setTimeout(function(){location.href=${JSON.stringify(appUrl).replace(/</g, '\\u003c')};},300);</script></body></html>`;
}
