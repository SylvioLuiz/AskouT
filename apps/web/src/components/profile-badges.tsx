import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { BoltIcon, CalendarIcon, TicketIcon, UsersIcon } from './icons.tsx';
import { Button, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';
import type { BadgeId, ProfileBadge } from '../lib/types.ts';

interface BadgeInfo {
  icon: () => ReactNode;
  name: () => string;
  /** Linha curta com a conquista (aparece ao passar o dedo/mouse e na folha). */
  summary: (b: ProfileBadge) => string;
  /** Como se ganha o selo. */
  rule: (b: ProfileBadge) => string;
}

const BADGES: Record<BadgeId, BadgeInfo> = {
  REFERRAL: {
    icon: () => <UsersIcon />,
    name: () => t('Trouxe a galera'),
    summary: (b) => t('Trouxe {n} amigos para o AskouT', { n: b.count }),
    rule: (b) => t('Ganha quem convida {n} amigos que entram e voltam ao app em outro dia.', { n: b.threshold }),
  },
  ORGANIZER: {
    icon: () => <CalendarIcon />,
    name: () => t('Organizador'),
    summary: (b) => (b.count === 1 ? t('Organizou 1 evento com {min}+ pessoas', { min: b.threshold }) : t('Organizou {n} eventos com {min}+ pessoas', { n: b.count, min: b.threshold })),
    rule: (b) => t('Ganha quem cria um evento que reúne pelo menos {n} pessoas confirmadas. Só contam contas com mais de uma semana.', { n: b.threshold }),
  },
  REGULAR: {
    icon: () => <TicketIcon />,
    name: () => t('Figurinha carimbada'),
    summary: (b) => t('Foi a {n} eventos', { n: b.count }),
    rule: (b) => t('Ganha quem confirma presença e vai a {n} eventos de organizadores diferentes.', { n: b.threshold }),
  },
  NOW: {
    icon: () => <BoltIcon />,
    name: () => t('Topa tudo'),
    summary: (b) => t('Encontrou {n} pessoas pelo NOW', { n: b.count }),
    rule: (b) => t('Ganha quem se encontra pelo NOW com {n} pessoas diferentes.', { n: b.threshold }),
  },
};

const known = (badges: ProfileBadge[]) => badges.filter((b) => b.id in BADGES);

/**
 * Selos do perfil. Tocar num selo explica como ele se ganha; no próprio perfil a pessoa também pode esconder
 * ou mostrar o selo (escondido, só ela o vê, apagado).
 */
export function ProfileBadges({ badges, isSelf, onChanged }: { badges: ProfileBadge[]; isSelf: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState<ProfileBadge | undefined>(undefined);
  const list = known(badges);
  if (list.length === 0) return null;
  return (
    <>
      <ul className="profile__badges" aria-label={t('Selos')}>
        {list.map((b) => {
          const info = BADGES[b.id];
          return (
            <li key={b.id}>
              <button type="button" className={`profile__badge${b.hidden ? ' profile__badge--hidden' : ''}`} title={info.summary(b)} onClick={() => setOpen(b)} aria-haspopup="dialog">
                {info.icon()}
                <span>{info.name()}</span>
                {b.hidden ? <span className="visually-hidden">{t('(escondido)')}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {open ? (
        <BadgeSheet
          badge={open}
          isSelf={isSelf}
          onClose={() => setOpen(undefined)}
          onChanged={() => {
            setOpen(undefined);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function BadgeSheet({ badge, isSelf, onClose, onChanged }: { badge: ProfileBadge; isSelf: boolean; onClose: () => void; onChanged: () => void }) {
  const info = BADGES[badge.id];
  const [error, setError] = useState<string | undefined>(undefined);
  async function toggle() {
    setError(undefined);
    try {
      await api.setBadgeHidden(badge.id, !badge.hidden);
      onChanged();
    } catch (e) {
      setError(toApiError(e).message);
    }
  }
  return (
    <Sheet title={info.name()} onClose={onClose}>
      <div className="badgesheet">
        <span className="badgesheet__icon" aria-hidden="true">
          {info.icon()}
        </span>
        <p className="badgesheet__summary">{info.summary(badge)}</p>
        <p className="badgesheet__rule">{info.rule(badge)}</p>
        {isSelf ? (
          <>
            {badge.hidden ? <p className="badgesheet__note">{t('Escondido: só você vê este selo.')}</p> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button variant="secondary" full onClick={toggle}>
              {badge.hidden ? t('Mostrar no perfil') : t('Esconder do perfil')}
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
