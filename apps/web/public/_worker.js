// Cloudflare Pages: roda só para /assets/* (ver _routes.json); o resto do site é servido direto.
// Sem isto, um arquivo de /assets que não existe mais (de um deploy anterior) caía no fallback do SPA e voltava
// como index.html (text/html), e o navegador recusava o módulo. Aqui o arquivo inexistente vira 404 de verdade,
// e os que existem ganham cache longo: o nome tem o hash do conteúdo, então nunca mudam.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(request);
    if (!url.pathname.startsWith('/assets/')) return res;
    const type = res.headers.get('content-type') || '';
    if (res.status === 404 || type.includes('text/html')) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (res.status !== 200) return res;
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'public, max-age=31536000, immutable');
    return out;
  },
};
