import { useEffect, useMemo, useState } from 'react';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { Avatar, Button, EmptyState, GroupAvatar, Loading, Notice, PageHead } from '../components/ui.tsx';
import { CheckIcon } from '../components/icons.tsx';
import { conversationTitle } from '../lib/chat.ts';
import { prepareImage } from '../lib/chat-media.ts';
import { documentType, fileProblem, formatFileSize } from '../lib/chat-file.ts';
import { prepareVideoUpload } from '../lib/media-file.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';
import { peekIncomingShare, setIncomingShare, SHARE_IN_EVENT, shareKind } from '../lib/share-in.ts';
import type { IncomingShare } from '../lib/share-in.ts';
import type { PublicProfile } from '../lib/types.ts';
import { navigate } from '../router.tsx';

/** Para quem enviar: uma conversa que já existe ou um amigo (a conversa 1 a 1 abre na hora de enviar). */
type Target = { key: string; label: string; sub: string; conversationId?: string; userId?: string; avatar: PublicProfile | null; groupImage: string | null };

const MAX_TARGETS = 10;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function useIncomingShare(): IncomingShare | undefined {
  const [share, setShare] = useState(peekIncomingShare);
  useEffect(() => {
    const onChange = () => setShare(peekIncomingShare());
    window.addEventListener(SHARE_IN_EVENT, onChange);
    return () => window.removeEventListener(SHARE_IN_EVENT, onChange);
  }, []);
  return share;
}

/**
 * "Enviar para…": o que veio de outro app (fotos, vídeos, PDF, documentos, link) vai direto para uma ou mais
 * conversas, como no WhatsApp. Conversas recentes primeiro, depois os amigos sem conversa ainda.
 */
export function ShareInScreen() {
  useTitle(t('Enviar para…'));
  const share = useIncomingShare();
  const convs = useAsync(() => api.conversations(), []);
  const friends = useAsync(() => api.friends(), []);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  const targets = useMemo<Target[]>(() => {
    const list: Target[] = [];
    const withChat = new Set<string>();
    for (const c of convs.data?.items ?? []) {
      if (!c.canSend) continue;
      if (c.other) withChat.add(c.other.userId);
      list.push({ key: `c:${c.id}`, label: conversationTitle(c), sub: c.other ? `@${c.other.username}` : t('Grupo'), conversationId: c.id, avatar: c.other, groupImage: c.imageUrl });
    }
    for (const f of friends.data ?? []) {
      if (withChat.has(f.userId)) continue;
      list.push({ key: `u:${f.userId}`, label: f.displayName, sub: `@${f.username}`, userId: f.userId, avatar: f, groupImage: null });
    }
    return list;
  }, [convs.data, friends.data]);

  const shown = query.trim() === '' ? targets : targets.filter((x) => fold(`${x.label} ${x.sub}`).includes(fold(query.trim())));
  const files = share?.files ?? [];
  const unsupported = files.filter((f) => !shareKind(f));
  const sendable = files.filter((f) => shareKind(f));

  function toggle(key: string) {
    setChosen((current) => (current.includes(key) ? current.filter((k) => k !== key) : current.length >= MAX_TARGETS ? current : [...current, key]));
  }

  async function sendTo(conversationId: string, prepared: { kind: 'IMAGE' | 'VIDEO' | 'FILE'; blob: Blob; name: string; type: string }[], text: string) {
    for (const item of prepared) {
      if (item.kind === 'FILE') await api.sendFile(conversationId, item.blob, item.name, item.type);
      else await api.sendMedia(conversationId, item.blob);
    }
    if (text !== '') await api.sendText(conversationId, text);
  }

  async function send() {
    if (chosen.length === 0 || sending) return;
    setProblem(undefined);
    try {
      // Prepara uma vez (reduz fotos e vídeos) e envia o mesmo arquivo para cada conversa.
      setSending(t('Preparando…'));
      const prepared: { kind: 'IMAGE' | 'VIDEO' | 'FILE'; blob: Blob; name: string; type: string }[] = [];
      for (const file of sendable) {
        const kind = shareKind(file)!;
        if (kind === 'FILE') {
          const trouble = fileProblem(file);
          if (trouble) throw new Error(`${file.name}: ${trouble}`);
          prepared.push({ kind, blob: file, name: file.name, type: documentType(file.name, file.type) ?? file.type });
        } else if (kind === 'IMAGE') {
          prepared.push({ kind, blob: await prepareImage(file), name: file.name, type: 'image/jpeg' });
        } else {
          prepared.push({ kind, blob: await prepareVideoUpload(file, () => undefined), name: file.name, type: file.type });
        }
      }
      const text = [share?.text ?? '', caption.trim()].filter((x) => x !== '').join('\n');
      const picked = targets.filter((x) => chosen.includes(x.key));
      let last: string | undefined;
      for (const [index, target] of picked.entries()) {
        setSending(picked.length > 1 ? t('Enviando para {name} ({n} de {total})…', { name: target.label, n: index + 1, total: picked.length }) : t('Enviando para {name}…', { name: target.label }));
        const conversationId = target.conversationId ?? (await api.openConversation(target.userId!)).id;
        await sendTo(conversationId, prepared, text);
        last = conversationId;
      }
      setIncomingShare(undefined);
      navigate(picked.length === 1 && last ? `/conversas/${last}` : '/conversas', { replace: true });
    } catch (failure) {
      setProblem(failure instanceof Error && !('code' in failure) && failure.message ? failure.message : toApiError(failure).message);
      setSending(undefined);
    }
  }

  if (!share || (files.length === 0 && share.text === '')) {
    return (
      <>
        <PageHead title={t('Enviar para…')} back="/conversas" />
        <EmptyState title={t('Nada para enviar')}>{t('Em outro app, toque em Compartilhar e escolha o AskouT para mandar fotos, vídeos, PDFs ou links para seus amigos.')}</EmptyState>
      </>
    );
  }

  return (
    <div className="sharein">
      <PageHead title={t('Enviar para…')} back="/conversas" />
      <ul className="sharein__items" aria-label={t('O que vai ser enviado')}>
        {files.map((f, i) => (
          <li key={`${f.name}-${i}`} className={shareKind(f) ? '' : 'is-off'}>
            <strong>{f.name}</strong>
            <span>{shareKind(f) === 'IMAGE' ? t('Foto') : shareKind(f) === 'VIDEO' ? t('Vídeo') : shareKind(f) === 'FILE' ? formatFileSize(f.size) : t('Tipo não aceito')}</span>
          </li>
        ))}
        {share.text ? (
          <li>
            <strong className="sharein__link">{share.text}</strong>
          </li>
        ) : null}
      </ul>
      {unsupported.length > 0 ? <Notice>{t('Alguns arquivos não podem ir pelo chat e ficam de fora. Dá para enviar fotos, vídeos, PDF, documentos, planilhas e apresentações.')}</Notice> : null}
      <label className="sharein__caption">
        <span className="visually-hidden">{t('Mensagem (opcional)')}</span>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t('Escreva uma mensagem (opcional)')} maxLength={2000} />
      </label>
      <label className="sharein__search">
        <span className="visually-hidden">{t('Buscar conversa ou amigo')}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Buscar conversa ou amigo')} autoComplete="off" />
      </label>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {(convs.loading && !convs.data) || (friends.loading && !friends.data) ? <Loading /> : null}
      {convs.data && friends.data && targets.length === 0 ? <EmptyState title={t('Ninguém para enviar ainda')}>{t('Quando você tiver amigos ou conversas, eles aparecem aqui.')}</EmptyState> : null}
      <ul className="sharein__list" aria-label={t('Conversas e amigos')}>
        {shown.map((x) => {
          const on = chosen.includes(x.key);
          return (
            <li key={x.key}>
              <button type="button" className={`sharein__row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(x.key)} disabled={sending !== undefined}>
                {x.avatar ? <Avatar profile={x.avatar} size={44} /> : <GroupAvatar name={x.label} size={44} imageUrl={x.groupImage} />}
                <span className="sharein__who">
                  <strong>{x.label}</strong>
                  <span>{x.sub}</span>
                </span>
                <span className="sharein__check" aria-hidden="true">
                  {on ? <CheckIcon /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sharein__bar">
        <span className="sharein__count">{sending ?? (chosen.length === 0 ? t('Escolha para quem enviar') : chosen.length === 1 ? t('1 escolhido') : t('{n} escolhidos', { n: chosen.length }))}</span>
        <Button loading={sending !== undefined} disabled={chosen.length === 0 || (sendable.length === 0 && share.text === '' && caption.trim() === '')} onClick={() => void send()}>
          {t('Enviar')}
        </Button>
      </div>
    </div>
  );
}
