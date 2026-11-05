import { useState } from 'react';
import { StoryViewer } from './event-story.tsx';
import { Avatar } from './ui.tsx';
import { LocationIcon } from './icons.tsx';
import type { StoryPos } from '../lib/stories.ts';
import type { EventStoryGroup } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/** Onde a pessoa está agora: o local (ou o evento) do story mais recente dela. */
function where(group: EventStoryGroup): string | undefined {
  const last = group.items[group.items.length - 1];
  return last?.event ? (last.event.place ?? last.event.title) : undefined;
}

/**
 * Faixa de stories da página inicial: os seus e os dos amigos que escolheram publicar também no perfil.
 * Cada story veio de um evento; quem não publicou no perfil fica só no evento e não aparece aqui.
 */
export function FriendStories({ groups, onChanged }: { groups: EventStoryGroup[]; onChanged: () => void }) {
  const [viewing, setViewing] = useState<StoryPos | undefined>();
  if (groups.length === 0) return null;
  return (
    <section className="homestories" aria-label={t('Stories dos amigos')}>
      <ul className="homestories__list">
        {groups.map((group, index) => (
          <li key={group.author.userId}>
            <button
              type="button"
              className="homestories__item"
              onClick={() => setViewing({ group: index, item: 0 })}
              aria-label={
                group.mine
                  ? t('Ver o seu story')
                  : where(group)
                    ? t('Ver o story de {username}, que está em {title}', { username: group.author.username, title: where(group) ?? '' })
                    : t('Ver o story de {username}', { username: group.author.username })
              }
            >
              <span className="homestories__ring">
                <Avatar profile={group.author} size={60} />
              </span>
              <span className="homestories__name">{group.mine ? t('Seu story') : group.author.username}</span>
              {where(group) ? (
                <span className="homestories__where">
                  <LocationIcon />
                  <span>{where(group)}</span>
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {viewing ? (
        <StoryViewer
          groups={groups}
          start={viewing}
          onClose={() => setViewing(undefined)}
          onChanged={() => {
            setViewing(undefined);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
