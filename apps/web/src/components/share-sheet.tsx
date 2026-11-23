import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { CheckIcon, CopyIcon, InstagramIcon, MailIcon, MoreIcon, SearchIcon, SendIcon, WhatsAppIcon } from './icons.tsx';
import { Avatar, Button, ErrorState, GroupAvatar, Loading, Notice, useOnce } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { emailLink, filterTargets, nativeShare, nativeShareAvailable, sentText, shareTargets, telegramLink, whatsappLink } from '../lib/share-targets.ts';
import type { ShareTarget } from '../lib/share-targets.ts';
import { renderShareCard, shareCardImage } from '../lib/share-card.ts';
import type { ShareCard } from '../lib/share-card.ts';
import { showToast } from '../lib/toast.ts';
import { t } from '../lib/i18n/index.ts';
import './share-sheet.css';

/** Ação rápida extra (ex.: "Postar no perfil" de um evento). */
export interface ShareAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  on?: boolean;
  busy?: boolean;
}

type Feedback = { tone: 'ok' | 'error'; text: string };

const NOTE_MAX = 500;

function isNativeApp(): boolean {
  try {
    return Boolean((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Sem permissão (WebView, iframe, http): tenta o jeito antigo abaixo.
  }
  // Fora de https, ou sem permissão, o navegador não dá acesso à área de transferência pela API nova.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('copy-failed');
}

/**
 * Folha de compartilhar no padrão dos apps de mercado: busca + grade de conversas e amigos recentes
 * (toque em um ou mais, mensagem opcional, Enviar) e, embaixo, uma linha de atalhos (copiar link, WhatsApp...).
 * `link` vazio = só dentro do app (ex.: evento privado). `inApp={false}` = só os atalhos de fora (WhatsApp, link...).
 */
export function ShareSheet({ title = t('Compartilhar'), link, card, send, onShared, actions = [], note, sentToast, initialConversations = [], inApp = true, already, onClose }: {
  title?: string;
  link?: { title: string; text: string; url: string };
  /** Cartão pronto para postar no Instagram (Feed/Stories) e outras redes: imagem + legenda. Só com `link`. */
  card?: () => Promise<ShareCard>;
  /** Envia para uma conversa; `message` é o texto opcional que a pessoa escreveu. */
  send: (conversationId: string, message: string | undefined) => Promise<unknown>;
  onShared?: () => void;
  actions?: ShareAction[];
  note?: ReactNode;
  /** Texto do aviso rápido depois de enviar a todos (recebe os nomes). Com ele, a folha fecha sozinha ao enviar. */
  sentToast?: (names: string[]) => string;
  /** Conversas que já abrem marcadas (ex.: a conversa da votação de data que virou evento). */
  initialConversations?: string[];
  /** false: sem a grade de conversas e amigos, só os atalhos para fora do app. */
  inApp?: boolean;
  /** Pessoas que já receberam (ex.: convidados de um evento): aparecem com o selo `label` e continuam podendo receber de novo. */
  already?: { userIds: ReadonlySet<string>; label: string };
  onClose: () => void;
}) {
  const data = useAsync(() => (inApp ? Promise.all([api.conversations(), api.friends().catch(() => [])]) : Promise.resolve(null)), [inApp]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(() => initialConversations.map((id) => `c:${id}`));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | undefined>();
  const [copied, setCopied] = useState(false);
  const opened = useRef(new Map<string, string>());
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // O cartão é montado assim que a folha abre: no toque, o menu do aparelho precisa abrir na hora
  // (o Safari recusa o navigator.share se a imagem demorar a ficar pronta depois do toque).
  const cardRef = useRef(card);
  const [prepared, setPrepared] = useState<Promise<{ card: ShareCard; blob: Blob }> | undefined>();
  useEffect(() => {
    const build = cardRef.current;
    if (!build || !link) return;
    const job = build().then(async (c) => ({ card: c, blob: await renderShareCard(c) }));
    job.catch(() => undefined);
    setPrepared(job);
  }, [Boolean(link)]);

  const targets = useMemo(() => (data.data ? shareTargets(data.data[0].items, data.data[1]) : []), [data.data]);
  const visible = useMemo(() => filterTargets(targets, query), [targets, query]);
  const chosen = targets.filter((target) => picked.includes(target.key));
  const native = isNativeApp();

  function toggle(target: ShareTarget) {
    setFeedback(undefined);
    setPicked((current) => (current.includes(target.key) ? current.filter((k) => k !== target.key) : [...current, target.key]));
  }

  async function conversationOf(target: ShareTarget): Promise<string> {
    if (target.conversationId) return target.conversationId;
    const known = opened.current.get(target.key);
    if (known) return known;
    const { id } = await api.openConversation(target.userId!);
    opened.current.set(target.key, id);
    return id;
  }

  async function sendNow() {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    setFeedback(undefined);
    const text = message.trim() || undefined;
    const results = await Promise.allSettled(chosen.map(async (target) => send(await conversationOf(target), text)));
    const ok = chosen.filter((_, i) => results[i]?.status === 'fulfilled');
    const failed = chosen.filter((_, i) => results[i]?.status === 'rejected');
    setSent((current) => [...current, ...ok.map((target) => target.key)]);
    setPicked(failed.map((target) => target.key));
    if (ok.length > 0) onShared?.();
    if (failed.length === 0 && sentToast) {
      showToast(sentToast(ok.map((target) => target.name)), 800);
      setBusy(false);
      onClose();
      return;
    }
    if (failed.length === 0) {
      setMessage('');
      setFeedback({ tone: 'ok', text: sentText(ok.map((target) => target.name)) });
    } else {
      const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      const reason = first ? toApiError(first.reason).message : '';
      setFeedback({
        tone: 'error',
        text: ok.length > 0 ? t('Enviado para {ok} de {total}. Não foi para {name}: {reason}', { ok: ok.length, total: chosen.length, name: failed.map((f) => f.name).join(', '), reason }) : reason,
      });
    }
    setBusy(false);
  }

  async function copyLink() {
    if (!link) return;
    setFeedback(undefined);
    try {
      await copyText(link.url);
      onShared?.();
      setCopied(true);
      setFeedback({ tone: 'ok', text: t('Link copiado.') });
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setFeedback({ tone: 'error', text: t('Não foi possível copiar. O link é {url}', { url: link.url }) });
    }
  }

  // O menu do aparelho não abre duas vezes: o segundo toque enquanto ele está aberto é ignorado.
  const [more, sharingNative] = useOnce(async () => {
    if (!link) return;
    setFeedback(undefined);
    try {
      if (await nativeShare(link)) onShared?.();
    } catch {
      setFeedback({ tone: 'error', text: t('Não foi possível abrir o menu do aparelho. Use "Copiar link".') });
    }
  });

  const [postCard, postingCard] = useOnce(async () => {
    if (!prepared) return;
    setFeedback(undefined);
    let ready: { card: ShareCard; blob: Blob };
    try {
      ready = await prepared;
    } catch {
      setFeedback({ tone: 'error', text: t('Não foi possível montar a imagem. Use "Copiar link".') });
      return;
    }
    let copiedCaption = true;
    try {
      await copyText(ready.card.caption);
    } catch {
      copiedCaption = false;
    }
    try {
      const result = await shareCardImage(ready.blob, ready.card.name, ready.card.caption);
      if (result === 'cancelled') return;
      onShared?.();
      if (result === 'saved') setFeedback({ tone: 'ok', text: copiedCaption ? t('Imagem baixada e legenda copiada. Poste no Instagram e cole a legenda.') : t('Imagem baixada. Poste no Instagram com o link do AskouT.') });
      else if (copiedCaption) showToast(t('Legenda copiada: é só colar no post.'), 2500);
    } catch {
      setFeedback({ tone: 'error', text: t('Não foi possível abrir o menu do aparelho. Use "Copiar link".') });
    }
  });

  /** WhatsApp, Telegram, e-mail: no app nativo a navegação sai para o app certo; no navegador abre outra aba. */
  function external(href: string, newTab = true) {
    onShared?.();
    if (native || !newTab) window.location.href = href;
    else window.open(href, '_blank', 'noopener');
  }

  const loading = data.loading && !data.data;
  const empty = inApp && !loading && !data.error && targets.length === 0;

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="sharesheet">
        {targets.length > 0 ? (
          <label className="sharesheet__search">
            <SearchIcon />
            <span className="visually-hidden">{t('Buscar conversa ou amigo')}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar')} autoComplete="off" enterKeyHint="search" />
          </label>
        ) : null}

        {loading ? <Loading /> : null}
        {data.error ? <ErrorState message={data.error.message} onRetry={data.reload} /> : null}
        {empty ? (
          <div className="sharesheet__empty">
            <strong>{t('Ninguém para enviar ainda')}</strong>
            <span>{t('Quando você e outra pessoa se seguirem, ela aparece aqui. Até lá, mande o link pelos atalhos abaixo.')}</span>
          </div>
        ) : null}
        {!loading && targets.length > 0 && visible.length === 0 ? <p className="sharesheet__none">{t('Ninguém encontrado com esse nome.')}</p> : null}

        {visible.length > 0 ? (
          <ul className="sharesheet__grid" aria-label={t('Conversas e amigos')}>
            {visible.map((target) => {
              const on = picked.includes(target.key);
              const done = sent.includes(target.key) && !on;
              const before = !done && !on && target.profile !== undefined && already?.userIds.has(target.profile.userId) === true;
              return (
                <li key={target.key}>
                  <button type="button" className={`sharesheet__person${on ? ' sharesheet__person--on' : ''}`} aria-pressed={on} onClick={() => toggle(target)} disabled={busy}>
                    <span className="sharesheet__face">
                      {target.group ? <GroupAvatar name={target.group.name} size={56} imageUrl={target.group.imageUrl} /> : target.profile ? <Avatar profile={target.profile} size={56} /> : null}
                      {on ? (
                        <span className="sharesheet__check" aria-hidden="true">
                          <CheckIcon />
                        </span>
                      ) : null}
                    </span>
                    <span className="sharesheet__name">{target.name}</span>
                    {done ? <span className="sharesheet__sent">{already ? already.label : t('Enviado')}</span> : before ? <span className="sharesheet__sent sharesheet__sent--before">{already!.label}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {note ? <p className="muted sharesheet__note">{note}</p> : null}
        {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}

        <div className="sharesheet__foot">
          {chosen.length > 0 ? (
            <form
              className="sharesheet__compose"
              onSubmit={(event) => {
                event.preventDefault();
                void sendNow();
              }}
            >
              <label className="visually-hidden" htmlFor="share-message">
                {t('Escreva uma mensagem (opcional)')}
              </label>
              <input id="share-message" className="sharesheet__message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={NOTE_MAX} placeholder={t('Escreva uma mensagem...')} autoComplete="off" enterKeyHint="send" />
              <Button type="submit" full loading={busy}>
                {chosen.length === 1 ? t('Enviar') : t('Enviar para {n}', { n: chosen.length })}
              </Button>
            </form>
          ) : (
            <ul className="sharesheet__actions" aria-label={t('Outras formas de compartilhar')}>
              {actions.map((action) => (
                <li key={action.key}>
                  <button type="button" className={`sharesheet__action${action.on ? ' sharesheet__action--on' : ''}`} onClick={action.onClick} disabled={action.busy} aria-pressed={action.on}>
                    <span className="sharesheet__bubble">{action.icon}</span>
                    <span>{action.label}</span>
                  </button>
                </li>
              ))}
              {link ? (
                <>
                  <li>
                    <button type="button" className="sharesheet__action" onClick={() => void copyLink()}>
                      <span className="sharesheet__bubble">{copied ? <CheckIcon /> : <CopyIcon />}</span>
                      <span>{copied ? t('Copiado') : t('Copiar link')}</span>
                    </button>
                  </li>
                  {prepared ? (
                    <li>
                      <button type="button" className="sharesheet__action" disabled={postingCard} onClick={() => postCard()} aria-label={t('Instagram: imagem pronta com legenda para o Feed ou Stories')}>
                        <span className="sharesheet__bubble sharesheet__bubble--instagram">
                          <InstagramIcon />
                        </span>
                        <span>{t('Instagram')}</span>
                      </button>
                    </li>
                  ) : null}
                  <li>
                    <button type="button" className="sharesheet__action" onClick={() => external(whatsappLink(link.text, link.url))}>
                      <span className="sharesheet__bubble sharesheet__bubble--whatsapp">
                        <WhatsAppIcon />
                      </span>
                      <span>{t('WhatsApp')}</span>
                    </button>
                  </li>
                  <li>
                    <button type="button" className="sharesheet__action" onClick={() => external(telegramLink(link.text, link.url))}>
                      <span className="sharesheet__bubble sharesheet__bubble--telegram">
                        <SendIcon />
                      </span>
                      <span>{t('Telegram')}</span>
                    </button>
                  </li>
                  <li>
                    <button type="button" className="sharesheet__action" onClick={() => external(emailLink(link.title, link.text, link.url), false)}>
                      <span className="sharesheet__bubble">
                        <MailIcon />
                      </span>
                      <span>{t('E-mail')}</span>
                    </button>
                  </li>
                  {nativeShareAvailable() ? (
                    <li>
                      <button type="button" className="sharesheet__action" disabled={sharingNative} onClick={() => more()}>
                        <span className="sharesheet__bubble">
                          <MoreIcon />
                        </span>
                        <span>{t('Mais opções')}</span>
                      </button>
                    </li>
                  ) : null}
                </>
              ) : null}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
