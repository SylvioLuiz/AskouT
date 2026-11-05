const CONNECTED_KEY = 'askout.contacts.connected';

/** True depois que a pessoa já conferiu a agenda neste aparelho. Sem armazenamento, conta como não conectada (o convite continua aparecendo). */
export function contactsConnected(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Grava que a agenda já foi conferida, para o card "Conecte seus contatos" sair do topo das sugestões e da tela Amigos. */
export function markContactsConnected(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(CONNECTED_KEY, '1');
  } catch {
    // Sem armazenamento: o card só continua aparecendo.
  }
}
