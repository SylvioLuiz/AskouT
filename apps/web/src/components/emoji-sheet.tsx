import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { SearchIcon } from './icons.tsx';
import { Notice } from './ui.tsx';
import { firstEmoji } from '../lib/chat-media.ts';
import { EMOJI_CATEGORIES, emojiCategoryLabel, pushRecentEmoji, readRecentEmojis, searchEmojis } from '../lib/emoji-data.ts';
import type { EmojiCategoryId } from '../lib/emoji-data.ts';
import { safeStorage } from '../lib/hints.ts';
import { t } from '../lib/i18n/index.ts';

type TabId = 'recent' | EmojiCategoryId;

/**
 * Todos os emojis, como o "+" das reações do Instagram: busca, usados recentemente e as categorias com abas.
 * Digitar um emoji pelo teclado do celular no campo de busca também escolhe.
 */
export function EmojiSheet({ selected, busy, problem, onPick, onClose }: { selected?: string; busy?: boolean; problem?: string; onPick: (emoji: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [recent] = useState(() => readRecentEmojis(safeStorage()));
  const [active, setActive] = useState<TabId>(recent.length > 0 ? 'recent' : 'people');
  const body = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchEmojis(query), [query]);
  const searching = query.trim().length > 0;
  const tabs: { id: TabId; icon: string; label: string }[] = [
    ...(recent.length > 0 ? [{ id: 'recent' as const, icon: '🕘', label: t('Usados recentemente') }] : []),
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, icon: c.icon, label: emojiCategoryLabel(c.id) })),
  ];

  function pick(emoji: string) {
    if (busy) return;
    pushRecentEmoji(safeStorage(), emoji);
    onPick(emoji);
  }

  function go(id: TabId) {
    setQuery('');
    setActive(id);
    // Depois de limpar a busca as seções voltam; rola até a escolhida.
    window.requestAnimationFrame(() => {
      const root = body.current;
      const section = root?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (root && section) root.scrollTo({ top: section.offsetTop, behavior: 'smooth' });
    });
  }

  // A aba acesa acompanha a seção que está no topo enquanto a pessoa rola.
  useEffect(() => {
    const root = body.current;
    if (!root || searching) return;
    const onScroll = () => {
      const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'));
      const y = root.scrollTop + 24;
      let current = sections[0]?.dataset.section;
      for (const s of sections) if (s.offsetTop <= y) current = s.dataset.section;
      if (current) setActive(current as TabId);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [searching]);

  const grid = (emojis: readonly string[], label: string) => (
    <div className="emojisheet__grid" role="group" aria-label={label}>
      {emojis.map((emoji) => (
        <button key={emoji} type="button" className={`emojisheet__btn${selected === emoji ? ' is-on' : ''}`} aria-label={t('Reagir com {emoji}', { emoji })} aria-pressed={selected === emoji} disabled={busy} onClick={() => pick(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );

  return (
    <Sheet title={t('Reações')} onClose={onClose}>
      <div className="emojisheet">
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <label className="emojisheet__search">
          <SearchIcon />
          <span className="visually-hidden">{t('Pesquisar emoji')}</span>
          <input
            type="search"
            value={query}
            placeholder={t('Pesquisar emoji')}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => {
              const value = e.target.value;
              // Emoji vindo do teclado do celular: já reage com ele.
              const typed = firstEmoji(value);
              if (typed) {
                setQuery('');
                pick(typed);
                return;
              }
              setQuery(value);
            }}
          />
        </label>
        <div className="emojisheet__tabs" role="tablist" aria-label={t('Categorias de emoji')}>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" className={`emojisheet__tab${!searching && active === tab.id ? ' is-on' : ''}`} aria-selected={!searching && active === tab.id} aria-label={tab.label} title={tab.label} onClick={() => go(tab.id)}>
              <span aria-hidden="true">{tab.icon}</span>
            </button>
          ))}
        </div>
        <div className="emojisheet__body" ref={body}>
          {searching ? (
            results.length > 0 ? (
              grid(results, t('Resultados da busca'))
            ) : (
              <p className="emojisheet__empty muted">{t('Nenhum emoji encontrado. Você também pode digitar um emoji pelo teclado.')}</p>
            )
          ) : (
            <>
              {recent.length > 0 ? (
                <section data-section="recent">
                  <h3 className="emojisheet__title">{t('Usados recentemente')}</h3>
                  {grid(recent, t('Usados recentemente'))}
                </section>
              ) : null}
              {EMOJI_CATEGORIES.map((category) => (
                <section key={category.id} data-section={category.id}>
                  <h3 className="emojisheet__title">{emojiCategoryLabel(category.id)}</h3>
                  {grid(category.items.map((i) => i.emoji), emojiCategoryLabel(category.id))}
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
