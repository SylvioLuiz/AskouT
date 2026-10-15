import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../client.ts';
import { Button, EmptyState, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { useTitle } from '../hooks.ts';
import { canPickContacts, CONTACTS_MAX, emailsFromVcf, pickContactEmails, sha256Hex } from '../lib/contacts.ts';
import { toApiError } from '../lib/errors.ts';
import type { PublicProfile } from '../lib/types.ts';

/** Achar amigos nos contatos. Os e-mails ficam no aparelho: só o código SHA-256 de cada um vai ao servidor, e nada é guardado. */
export function ContactsScreen() {
  useTitle('Contatos');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | undefined>();
  const [found, setFound] = useState<PublicProfile[] | undefined>();
  const [followed, setFollowed] = useState<Record<string, 'ACCEPTED' | 'PENDING'>>({});
  const [followingBusy, setFollowingBusy] = useState<string | undefined>();

  async function search(emails: string[]) {
    if (emails.length === 0) {
      setMessage({ tone: 'info', text: 'Não encontrei e-mails nesses contatos.' });
      return;
    }
    const hashes = await Promise.all(emails.slice(0, CONTACTS_MAX).map((e) => sha256Hex(e)));
    const result = await api.contactMatches(hashes);
    setFound(result.items);
    setFollowed({});
    setMessage(
      emails.length > CONTACTS_MAX
        ? { tone: 'info', text: `Conferi os primeiros ${CONTACTS_MAX} contatos.` }
        : undefined,
    );
  }

  async function run(job: () => Promise<string[]>) {
    setBusy(true);
    setMessage(undefined);
    try {
      await search(await job());
    } catch (failure) {
      // Fechar o seletor sem escolher ninguém não é erro.
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: failure instanceof Error && !('status' in failure) ? failure.message : toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5_000_000) {
      setMessage({ tone: 'error', text: 'O arquivo é grande demais. Use até 5 MB.' });
      return;
    }
    await run(async () => emailsFromVcf(await file.text()));
  }

  async function follow(profile: PublicProfile) {
    setFollowingBusy(profile.userId);
    try {
      const result = await api.follow(profile.userId);
      setFollowed((current) => ({ ...current, [profile.userId]: result.status }));
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setFollowingBusy(undefined);
    }
  }

  return (
    <>
      <PageHead title="Achar nos contatos" back="/amigos" subtitle="Veja quais dos seus contatos já estão no AskouT" />
      <p className="muted">
        Os e-mails dos seus contatos não saem do aparelho: só um código irreversível de cada um é enviado para conferir quem tem conta. O AskouT não guarda esses códigos nem sua lista de contatos.
      </p>
      <div className="stack">
        {canPickContacts() ? (
          <Button loading={busy} onClick={() => void run(pickContactEmails)}>
            Escolher contatos
          </Button>
        ) : null}
        <Button variant={canPickContacts() ? 'secondary' : 'primary'} loading={busy} onClick={() => fileRef.current?.click()}>
          Enviar arquivo de contatos (.vcf)
        </Button>
        <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(e) => void onFile(e)} />
      </div>
      {!canPickContacts() ? <p className="muted">No iPhone, abra Contatos, escolha as pessoas, toque em Compartilhar e salve o arquivo .vcf para enviar aqui. O app do celular vai ler os contatos direto, mais para frente.</p> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {found && found.length === 0 ? <EmptyState title="Ninguém novo por aqui">Nenhum dos contatos que você enviou está no AskouT ou todos já estão entre quem você segue.</EmptyState> : null}
      {found && found.length > 0 ? (
        <ul className="list">
          {found.map((p) => (
            <PersonRow
              key={p.userId}
              profile={p}
              realName
              aside={
                followed[p.userId] ? (
                  <span className="muted">{followed[p.userId] === 'PENDING' ? 'Pedido enviado' : 'Seguindo'}</span>
                ) : (
                  <Button small loading={followingBusy === p.userId} onClick={() => void follow(p)}>
                    Seguir
                  </Button>
                )
              }
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
