/** Só o que este arquivo usa do Express (o projeto não instala os tipos dele). */
interface Res {
  setHeader(name: string, value: string): unknown;
}

/**
 * Cabeçalhos de segurança básicos para a API (que só responde JSON e arquivos de mídia; nunca páginas).
 *  - nosniff: o navegador não "adivinha" o tipo do arquivo;
 *  - Referrer-Policy: não vaza o endereço de onde veio a chamada;
 *  - X-Frame-Options: a API não deve aparecer dentro de um iframe;
 *  - HSTS só em produção (a hospedagem entrega HTTPS), por seis meses e sem includeSubDomains.
 */
export function securityHeaders(options: { production: boolean }) {
  return (_req: unknown, res: Res, next: () => void): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (options.production) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  };
}
