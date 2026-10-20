const USERNAME = /^[a-z0-9._]{3,30}$/;
const KEY = 'askout.invite';

/** Link de convite: abre o cadastro já sabendo quem convidou. */
export function inviteUrl(origin: string, username: string): string {
  return `${origin}/cadastro?convite=${encodeURIComponent(username)}`;
}

export function inviteText(displayName: string): string {
  return `${displayName} te chamou para o AskouT, a rede social de rolês. Entra aí:`;
}

/** Abre o WhatsApp com a mensagem pronta (o app ou o WhatsApp Web, conforme o aparelho). */
export function whatsappUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

/** Lê e confere o usuário do parâmetro `convite`; qualquer coisa fora do padrão de usuário é ignorada. */
export function parseInvite(value: string | null | undefined): string | undefined {
  const name = (value ?? '').trim().toLowerCase().replace(/^@/, '');
  return USERNAME.test(name) ? name : undefined;
}

export function rememberInvite(storage: Pick<Storage, 'setItem'> | undefined, username: string): void {
  try {
    storage?.setItem(KEY, username);
  } catch {
    // sem armazenamento: o convite só não é lembrado entre telas
  }
}

/** Devolve o convite guardado e apaga, para valer uma vez só. */
export function takeInvite(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): string | undefined {
  try {
    const found = parseInvite(storage?.getItem(KEY));
    storage?.removeItem(KEY);
    return found;
  } catch {
    return undefined;
  }
}
