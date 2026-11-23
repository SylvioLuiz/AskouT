import { api } from '../client.ts';
import { useAsync, usePolling } from '../hooks.ts';
import { formatAge, formatRemaining, minutesLeft } from '../lib/flash.ts';
import { t } from '../lib/i18n/index.ts';
import { Link } from '../router.tsx';
import { BoltIcon } from './icons.tsx';

interface Props {
  inviteId: string;
  otherName: string;
  /** Local aceito no chat (o encontro também guarda o escolhido no mapa). */
  agreedName: string | undefined;
  onSuggest: () => void;
  onMap: () => void;
}

/**
 * Encontro do NOW fixado no topo da conversa: quanto falta, o local combinado e quando cada localização foi
 * atualizada. Tocar abre o encontro, que já liga e atualiza a sua localização sozinho; com a sua localização velha
 * (ou sem nenhuma), o cartão pede "Atualizar".
 */
export function MatchPin({ inviteId, otherName, agreedName, onSuggest, onMap }: Props) {
  const match = useAsync(() => api.flashMatch(inviteId), [inviteId]);
  usePolling(match.reload, 20_000);
  const m = match.data;
  const now = m?.now ?? new Date().toISOString();
  const place = m?.destination?.name ?? agreedName;
  const mine = m?.me ?? null;
  const theirs = m?.them ?? null;
  const needsUpdate = m !== undefined && (!mine || mine.stale);
  const left = m ? formatRemaining(minutesLeft(m.expiresAt, Date.parse(m.now))) : undefined;

  const where = place ? t('Local: {place}', { place }) : t('Sem local combinado');
  const me = !m ? '' : mine ? t('Você {age}', { age: formatAge(mine.updatedAt, now) }) : t('Sua localização desligada');
  const them = !m ? '' : theirs ? t('{name} {age}', { name: otherName, age: formatAge(theirs.updatedAt, now) }) : t('{name} sem localização', { name: otherName });

  return (
    <div className="matchpin">
      <Link to={`/now/encontro/${inviteId}`} className={`pollpin matchpin__main${needsUpdate ? ' is-todo' : ''}`} aria-label={t('Encontro NOW com {name}. Abrir o encontro', { name: otherName })}>
        <span className="pollpin__icon matchpin__icon" aria-hidden="true">
          <BoltIcon filled />
        </span>
        <span className="pollpin__text">
          <span className="pollpin__name">{left ? t('NOW · acaba em {left}', { left }) : t('Encontro NOW ativo')}</span>
          <span className="pollpin__status">{[where, me, them].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="pollpin__action">{needsUpdate ? t('Atualizar') : t('Abrir')}</span>
      </Link>
      <div className="matchpin__tools">
        <button type="button" className="matchpin__chip" onClick={onSuggest}>
          {place ? t('Mudar local') : t('Sugerir um local')}
        </button>
        <button type="button" className="matchpin__chip" onClick={onMap}>
          {t('Ver no mapa')}
        </button>
      </div>
    </div>
  );
}
