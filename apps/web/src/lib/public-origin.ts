/** Endereço público do app, usado em links que saem do aparelho (convites, compartilhar). */
export const PUBLIC_ORIGIN = 'https://askout.com.br';

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$|\.localhost$|\.local$/i;

/** Origem para links compartilhados. No app do celular (capacitor://localhost) e no ambiente local
 *  o endereço da página não abre para outra pessoa, então usa o público. */
export function shareOrigin(origin: string = typeof window === 'undefined' ? PUBLIC_ORIGIN : window.location.origin): string {
  try {
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || LOCAL_HOST.test(url.hostname)) return PUBLIC_ORIGIN;
    return url.origin;
  } catch {
    return PUBLIC_ORIGIN;
  }
}
