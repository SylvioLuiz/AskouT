import { useEffect, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { api } from '../client.ts';
import { useDebounced } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { getLocale, t } from '../lib/i18n/index.ts';
import type { CommentGif, GifItem } from '../lib/types.ts';
import { XIcon } from './icons.tsx';

/** Emojis mais usados em comentários. Quem quiser outros usa o teclado do aparelho. */
export const COMMENT_EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😅', '😉',
  '🙂', '🙃', '😋', '🤗', '🤔', '😮', '😢', '😭', '😡', '🥺', '😴', '🙄',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '👀', '🔥', '✨', '🎉', '🎶',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯', '🍻', '🍕', '🍔', '🍹',
];

let gifEnabled: Promise<boolean> | undefined;

/** O servidor diz se a Giphy está ligada (tem chave). Perguntado uma vez só; em dúvida, sem GIF. */
export function useGifEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    gifEnabled ??= api.gifStatus().then((r) => r.enabled, () => false);
    void gifEnabled.then((value) => live && setEnabled(value));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

function gifLang(): string {
  const locale = getLocale();
  return locale === 'pt-BR' ? 'pt' : locale;
}

/** Seletor de GIFs: os mais populares e busca. A atribuição "Powered by GIPHY" é exigida pela Giphy. */
export function GifPicker({ onPick, onClose }: { onPick: (gif: CommentGif) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q, 350);
  const [items, setItems] = useState<GifItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  async function load(offset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const page = await api.gifs(query, offset, gifLang());
      setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setNext(page.nextOffset);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <Sheet title={t('Escolher um GIF')} onClose={onClose}>
      <input className="gifpicker__search" type="search" value={q} onChange={(event) => setQ(event.target.value)} maxLength={50} placeholder={t('Buscar GIFs')} aria-label={t('Buscar GIFs')} autoComplete="off" />
      {error ? <p className="muted" role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p className="muted">{t('Nenhum GIF encontrado.')}</p> : null}
      {loading && items.length === 0 ? (
        <p className="gifpicker__loading muted" role="status">
          <span className="gifpicker__spinner" aria-hidden="true" />
          {t('Carregando GIFs…')}
        </p>
      ) : null}
      <ul className="gifpicker__grid">
        {items.map((gif) => (
          <li key={gif.id}>
            <button type="button" className="gifpicker__item" onClick={() => onPick({ id: gif.id, url: gif.url })} aria-label={gif.title || t('GIF')}>
              <GifImage url={gif.url} alt="" width={gif.width} height={gif.height} />
            </button>
          </li>
        ))}
      </ul>
      {next !== null ? (
        <button type="button" className="linkbtn" disabled={loading} onClick={() => void load(next)}>
          {t('Ver mais')}
        </button>
      ) : null}
      <p className="gifpicker__credit muted">{t('Powered by GIPHY')}</p>
    </Sheet>
  );
}

/**
 * Botões de emoji e GIF do campo de comentário. `onEmoji` acrescenta ao texto; `onGif` já publica o comentário.
 * `closeKey`: quando muda (ex.: a mensagem foi enviada), a bandeja de emojis fecha.
 * `combined`: um botão só (😊) e, no painel, as abas Emoji / GIF, como no WhatsApp.
 */
export function CommentTools({ onEmoji, onGif, disabled, closeKey, combined }: { onEmoji: (emoji: string) => void; onGif: (gif: CommentGif) => void; disabled?: boolean; closeKey?: number; combined?: boolean }) {
  const gifs = useGifEnabled();
  const [panel, setPanel] = useState<'emoji' | 'gif' | undefined>();
  useEffect(() => {
    if (closeKey) setPanel((p) => (p === 'emoji' ? undefined : p));
  }, [closeKey]);
  return (
    <>
      {panel === 'emoji' ? (
        <div className="emojipanel" role="group" aria-label={t('Emojis')}>
          {combined && gifs ? (
            <div className="emojipanel__tabs" role="tablist">
              <button type="button" role="tab" aria-selected="true" className="emojipanel__tab emojipanel__tab--on">
                {t('Emoji')}
              </button>
              <button type="button" role="tab" aria-selected="false" className="emojipanel__tab" onClick={() => setPanel('gif')}>
                {t('GIF')}
              </button>
            </div>
          ) : null}
          {COMMENT_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className="emojipanel__item" onClick={() => onEmoji(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <div className="commenttools">
        <button type="button" className={`commenttools__btn${panel === 'emoji' ? ' commenttools__btn--on' : ''}`} aria-pressed={panel === 'emoji'} aria-label={combined && gifs ? t('Emojis e GIFs') : t('Emojis')} disabled={disabled} onClick={() => setPanel((p) => (p === 'emoji' ? undefined : 'emoji'))}>
          <span aria-hidden="true">😊</span>
        </button>
        {gifs && !combined ? (
          <button type="button" className="commenttools__btn commenttools__btn--gif" aria-label={t('Adicionar um GIF')} disabled={disabled} onClick={() => setPanel('gif')}>
            GIF
          </button>
        ) : null}
      </div>
      {panel === 'gif' ? (
        <GifPicker
          onClose={() => setPanel(undefined)}
          onPick={(gif) => {
            setPanel(undefined);
            onGif(gif);
          }}
        />
      ) : null}
    </>
  );
}

/** Imagem de GIF com "carregando" até chegar; se a Giphy não entregar, um aviso no lugar. */
export function GifImage({ url, className, alt = t('GIF'), width, height }: { url: string; className?: string; alt?: string; width?: number; height?: number }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => setState('loading'), [url]);
  if (state === 'failed') return <span className={`gifimg gifimg--failed ${className ?? ''}`}>{t('GIF indisponível')}</span>;
  return (
    <span className={`gifimg${state === 'loading' ? ' gifimg--loading' : ''} ${className ?? ''}`} role={state === 'loading' ? 'status' : undefined} aria-busy={state === 'loading' || undefined}>
      {state === 'loading' ? <span className="visually-hidden">{t('Carregando GIF…')}</span> : null}
      <img src={url} alt={alt} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setState('ready')} onError={() => setState('failed')} />
    </span>
  );
}

/** O GIF dentro de um comentário ou de uma mensagem. */
export function CommentGifView({ gif }: { gif: CommentGif }) {
  return <GifImage url={gif.url} className="comment__gif" />;
}

/** Faixa acima da caixa de texto: "Respondendo a fulano", com o X para voltar a comentar normal. */
export function ReplyBanner({ name, onCancel }: { name: string; onCancel: () => void }) {
  return (
    <div className="replybanner" role="status">
      <span>{t('Respondendo a {name}', { name })}</span>
      <button type="button" className="replybanner__close" onClick={onCancel} aria-label={t('Cancelar resposta')}>
        <XIcon />
      </button>
    </div>
  );
}

/** Botão "Responder" debaixo do comentário. */
export function ReplyButton({ name, onReply }: { name: string; onReply: () => void }) {
  return (
    <button type="button" className="comment__reply" onClick={onReply} aria-label={t('Responder {name}', { name })}>
      {t('Responder')}
    </button>
  );
}
