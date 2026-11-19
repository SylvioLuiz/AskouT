/** Check-in no local pelo QR code: o link impresso leva ao app com o código secreto do local. */

const CODE = /^[A-Za-z0-9_-]{8,128}$/;
const RETURN_KEY = 'askout.checkin-return';
const RETURN_PATH = /^\/checkin\/[^/?#]+\?codigo=[A-Za-z0-9_-]{8,128}$/;

/** Endereço que o QR leva: abre direto na tela "Estive aqui" do local. */
export function checkinLink(origin: string, venueId: string, code: string): string {
  return `${origin}/checkin/${encodeURIComponent(venueId)}?codigo=${encodeURIComponent(code)}`;
}

/** Código do link (`?codigo=`), ou undefined se faltar ou vier malformado. */
export function codeFromSearch(search: string): string | undefined {
  const value = new URLSearchParams(search).get('codigo');
  return value !== null && CODE.test(value) ? value : undefined;
}

/** Quem abre o QR sem ter entrado volta para o check-in depois do login ou do cadastro. */
export function rememberCheckinReturn(storage: Pick<Storage, 'setItem'> | undefined, path: string): void {
  if (!RETURN_PATH.test(path)) return;
  try {
    storage?.setItem(RETURN_KEY, path);
  } catch {
    // sem armazenamento: o check-in só não retoma sozinho
  }
}

/** Devolve (e esquece) o check-in que estava esperando o login. */
export function takeCheckinReturn(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): string | undefined {
  try {
    const path = storage?.getItem(RETURN_KEY) ?? undefined;
    storage?.removeItem(RETURN_KEY);
    return path && RETURN_PATH.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** Nome do arquivo do QR para baixar. */
export function qrFileName(venueName: string): string {
  const slug = venueName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `qr-${slug || 'local'}.png`;
}
