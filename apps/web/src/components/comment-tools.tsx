import { useEffect, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { api } from '../client.ts';
import { useDebounced } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { getLocale, t } from '../lib/i18n/index.ts';
import type { CommentGif, GifItem } from '../lib/types.ts';

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

/** Botões de emoji e GIF do campo de comentário. `onEmoji` acrescenta ao texto; `onGif` já publica o comentário. */
export function CommentTools({ onEmoji, onGif, disabled }: { onEmoji: (emoji: string) => void; onGif: (gif: CommentGif) => void; disabled?: boolean }) {
  const gifs = useGifEnabled();
  const [panel, setPanel] = useState<'emoji' | 'gif' | undefined>();
  return (
    <>
      {panel === 'emoji' ? (
        <div className="emojipanel" role="group" aria-label={t('Emojis')}>
          {COMMENT_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className="emojipanel__item" onClick={() => onEmoji(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <div className="commenttools">
        <button type="button" className={`commenttools__btn${panel === 'emoji' ? ' commenttools__btn--on' : ''}`} aria-pressed={panel === 'emoji'} aria-label={t('Emojis')} disabled={disabled} onClick={() => setPanel((p) => (p === 'emoji' ? undefined : 'emoji'))}>
          <span aria-hidden="true">😊</span>
        </button>
        {gifs ? (
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
