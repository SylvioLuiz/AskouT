/**
 * Ponte `window.AskouTContacts`: lê a agenda do celular (com a permissão do aparelho) e devolve só celulares e e-mails.
 * O app web transforma cada um em código SHA-256 antes de mandar ao servidor; nomes e o resto da agenda nem saem daqui.
 */

type Permission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'limited';

export interface ContactsDeps {
  contacts: {
    checkPermissions(): Promise<{ contacts: Permission }>;
    requestPermissions(): Promise<{ contacts: Permission }>;
    getContacts(o: { projection: { phones: boolean; emails: boolean } }): Promise<{ contacts: { phones?: { number: string | null }[]; emails?: { address: string | null }[] }[] }>;
  };
}

export function createContactsBridge(deps: ContactsDeps) {
  return {
    async readAll(): Promise<{ emails: string[]; phones: string[] }> {
      let status = (await deps.contacts.checkPermissions()).contacts;
      if (status !== 'granted' && status !== 'limited') status = (await deps.contacts.requestPermissions()).contacts;
      if (status !== 'granted' && status !== 'limited') throw new Error('Sem permissão para ler a agenda. Libere o acesso aos contatos nos ajustes do celular.');
      const { contacts } = await deps.contacts.getContacts({ projection: { phones: true, emails: true } });
      const phones: string[] = [];
      const emails: string[] = [];
      for (const c of contacts) {
        for (const p of c.phones ?? []) if (p.number) phones.push(p.number);
        for (const e of c.emails ?? []) if (e.address) emails.push(e.address);
      }
      return { phones, emails };
    },
  };
}
