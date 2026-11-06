import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../client.ts';
import { Button, EmptyState, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { Sheet } from '../components/agenda.tsx';
import { useTitle } from '../hooks.ts';
import { canPickContacts, canSyncDeviceContacts, hashContactKeys, keysFromVcf, pickContacts, readDeviceContacts } from '../lib/contacts.ts';
import type { ContactKeys } from '../lib/contacts.ts';
import { toApiError } from '../lib/errors.ts';
import { markContactsConnected } from '../lib/contacts-prompt.ts';
import { safeStorage } from '../lib/hints.ts';
import type { PublicProfile } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Achar amigos nos contatos, por celular e por e-mail. Os dados ficam no aparelho: só o código SHA-256 de cada um vai ao servidor, e nada é guardado.
 * No app do celular sincroniza a agenda inteira; no navegador, pelo seletor de contatos (Chrome no Android) ou por arquivo .vcf.
 */
export function ContactsScreen() {
  useTitle(t('Contatos'));
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | undefined>();
  const [found, setFound] = useState<PublicProfile[] | undefined>();
  const [followed, setFollowed] = useState<Record<string, 'ACCEPTED' | 'PENDING'>>({});
  const [followingBusy, setFollowingBusy] = useState<string | undefined>();
  const [followingAll, setFollowingAll] = useState(false);
  // Aviso antes do pedido de permissão do celular (exigência do Google Play para dados sensíveis como a agenda).
  const [disclosure, setDisclosure] = useState(false);
  const native = canSyncDeviceContacts();
  const picker = canPickContacts();

  async function search(keys: ContactKeys) {
    if (keys.emails.length === 0 && keys.phones.length === 0) {
      setMessage({ tone: 'info', text: t('Não encontrei celulares nem e-mails nesses contatos.') });
      return;
    }
    const { hashes, phoneHashes, truncated } = await hashContactKeys(keys);
    const result = await api.contactMatches(hashes, phoneHashes);
    markContactsConnected(safeStorage());
    setFound(result.items);
    setFollowed({});
    setMessage(truncated ? { tone: 'info', text: t('A agenda é grande: conferi só uma parte dos contatos.') } : undefined);
  }

  async function run(job: () => Promise<ContactKeys>) {
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
      setMessage({ tone: 'error', text: t('O arquivo é grande demais. Use até 5 MB.') });
      return;
    }
    await run(async () => keysFromVcf(await file.text()));
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

  async function followAll(people: PublicProfile[]) {
    setFollowingAll(true);
    setMessage(undefined);
    try {
      for (const p of people) {
        const result = await api.follow(p.userId);
        setFollowed((current) => ({ ...current, [p.userId]: result.status }));
      }
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setFollowingAll(false);
    }
  }

  const notFollowed = (found ?? []).filter((p) => !followed[p.userId]);

  return (
    <>
      <PageHead title={t('Achar nos contatos')} back="/amigos" subtitle={t('Veja quais dos seus contatos já estão no AskouT')} />
      <p className="muted">
        {t('Os celulares e e-mails dos seus contatos não saem do aparelho: só um código irreversível de cada um é enviado para conferir quem tem conta. O AskouT não guarda esses códigos nem sua agenda.')}
      </p>
      <div className="stack">
        {native ? (
          <Button loading={busy} onClick={() => setDisclosure(true)}>
            {t('Sincronizar agenda do celular')}
          </Button>
        ) : null}
        {!native && picker ? (
          <Button loading={busy} onClick={() => void run(pickContacts)}>
            {t('Escolher contatos')}
          </Button>
        ) : null}
        {!native ? (
          <Button variant={picker ? 'secondary' : 'primary'} loading={busy} onClick={() => fileRef.current?.click()}>
            {t('Enviar arquivo de contatos (.vcf)')}
          </Button>
        ) : null}
        {disclosure ? (
          <Sheet title={t('Acesso aos seus contatos')} onClose={() => setDisclosure(false)}>
            <div className="stack">
              <p>{t('Para mostrar quais dos seus contatos já estão no AskouT, o app vai ler os celulares e e-mails da agenda deste aparelho.')}</p>
              <ul className="disclosure__list">
                <li>{t('Cada celular e e-mail vira um código irreversível antes de sair do aparelho. Nomes, fotos e o resto da agenda não são lidos.')}</li>
                <li>{t('Os códigos servem só para conferir quem tem conta. O AskouT não guarda esses códigos nem a sua agenda, e não manda mensagens para os seus contatos.')}</li>
                <li>{t('Você pode tirar a permissão quando quiser nos ajustes do celular.')}</li>
              </ul>
              <p className="muted">{t('Em seguida o celular vai pedir a sua permissão.')}</p>
              <Button
                full
                onClick={() => {
                  setDisclosure(false);
                  void run(readDeviceContacts);
                }}
              >
                {t('Continuar')}
              </Button>
              <Button full variant="quiet" onClick={() => setDisclosure(false)}>
                {t('Agora não')}
              </Button>
            </div>
          </Sheet>
        ) : null}
        <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(e) => void onFile(e)} />
      </div>
      {!native && !picker ? <p className="muted">{t('No iPhone, abra Contatos, escolha as pessoas, toque em Compartilhar e salve o arquivo .vcf para enviar aqui. No app do AskouT dá para sincronizar a agenda direto.')}</p> : null}
      <p className="muted">
        {t('Para seus amigos acharem você pela agenda deles,')} <Link to="/perfil/editar">{t('coloque seu celular no perfil')}</Link>.
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {found && found.length === 0 ? <EmptyState title={t('Ninguém novo por aqui')}>{t('Nenhum dos seus contatos está no AskouT ou todos já estão entre quem você segue.')}</EmptyState> : null}
      {found && found.length > 0 ? (
        <>
          {notFollowed.length > 1 ? (
            <div>
              <Button variant="secondary" small loading={followingAll} onClick={() => void followAll(notFollowed)}>
                {t('Seguir todos ({n})', { n: notFollowed.length })}
              </Button>
            </div>
          ) : null}
          <ul className="list">
            {found.map((p) => (
              <PersonRow
                key={p.userId}
                profile={p}
                realName
                aside={
                  followed[p.userId] ? (
                    <span className="muted">{followed[p.userId] === 'PENDING' ? t('Pedido enviado') : t('Seguindo')}</span>
                  ) : (
                    <Button small loading={followingBusy === p.userId} disabled={followingAll} onClick={() => void follow(p)}>
                      {t('Seguir')}
                    </Button>
                  )
                }
              />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
