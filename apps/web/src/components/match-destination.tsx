import { Button, Loading, Notice } from './ui.tsx';
import { formatDistance, formatTravel } from '../lib/flash.ts';
import { PlaceCarousel, type MorePlaces } from './suggestions.tsx';
import { OpenInMaps } from './open-in-maps.tsx';
import type { FlashLeg, FlashMatch, SuggestionItem, Suggestions } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';


interface PlacesProps {
  bothShared: boolean;
  loading: boolean;
  error: string | undefined;
  suggestions: Suggestions | undefined;
  places: readonly SuggestionItem[];
  otherName: string;
  selectedKey: string | undefined;
  busy: boolean;
  onSelect: (key: string) => void;
  onChoose: (item: SuggestionItem) => void;
  /** Lugares que você já sugeriu no chat e ainda esperam resposta. */
  openKeys?: ReadonlySet<string>;
  /** "Ver mais" no fim da lista. */
  more?: MorePlaces | undefined;
}

/** Lugares entre os dois, em cartões com rolagem horizontal numerados como os pins do mapa. "Sugerir no chat" manda o cartão para a conversa. */
export function MatchPlaces({ bothShared, loading, error, suggestions, places, otherName, selectedKey, busy, onSelect, onChoose, openKeys, more }: PlacesProps) {
  if (!bothShared) {
    return (
      <section className="matchplaces" aria-label={t('Lugares entre vocês')}>
        <h2 className="matchplaces__h">{t('Lugares entre vocês')}</h2>
        <p className="muted">{t('Quando os dois compartilharem a localização, os bares e eventos no meio do caminho aparecem aqui e no mapa.')}</p>
      </section>
    );
  }
  return (
    <section className="matchplaces" aria-label={t('Lugares entre vocês')}>
      <h2 className="matchplaces__h">{t('Lugares entre vocês')}</h2>
      {loading && !suggestions ? <Loading label={t('Buscando locais')} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {suggestions && suggestions.reason === null && places.length === 0 ? <p className="muted">{t('Nenhum evento ou local encontrado por perto agora.')}</p> : null}
      {places.length > 0 ? <p className="muted">{t('Toque em um lugar para ver no mapa e sugira no chat.')}</p> : null}
      <PlaceCarousel
        items={places}
        otherName={otherName}
        picked={selectedKey}
        onPick={onSelect}
        more={more}
        action={(item) =>
          openKeys?.has(item.key) ? (
            <Button small variant="secondary" disabled>
              {t('Sugestão aberta')}
            </Button>
          ) : (
            <Button small loading={busy && item.key === selectedKey} disabled={busy} onClick={() => onChoose(item)}>
              {t('Sugerir no chat')}
            </Button>
          )
        }
      />
      {suggestions && !suggestions.placesAvailable ? <p className="muted">{t('Não foi possível buscar locais agora. Mostrando só eventos do AskouT.')}</p> : null}
    </section>
  );
}

interface DestinationProps {
  match: FlashMatch;
  mode: 'foot' | 'driving';
  onMode: (mode: 'foot' | 'driving') => void;
  me: FlashLeg | null | undefined;
  them: FlashLeg | null | undefined;
  routesLoading: boolean;
  busy: boolean;
  onClear: () => void;
}

/** O lugar escolhido, com a rota (tempo e distância) de cada um e o botão que abre o trajeto no app de mapas. */
export function MatchDestination({ match, mode, onMode, me, them, routesLoading, busy, onClear }: DestinationProps) {
  const dest = match.destination;
  if (!dest) return null;
  const other = match.other.username;
  return (
    <section className="matchdest" aria-label={t('Lugar escolhido')}>
      <p className="matchdest__title">
        <span aria-hidden="true">★ </span>
        <strong>{dest.name}</strong>
      </p>
      <p className="muted">{t('Local combinado com {other}. Para trocar, sugira outro no chat.', { other })}</p>
      <div className="segtabs" role="tablist" aria-label={t('Como ir')}>
        <button type="button" role="tab" aria-selected={mode === 'foot'} className="segtabs__tab" onClick={() => onMode('foot')}>
          {t('A pé')}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'driving'} className="segtabs__tab" onClick={() => onMode('driving')}>
          {t('De carro')}
        </button>
      </div>
      {routesLoading && !me && !them ? <Loading label={t('Calculando a rota')} /> : null}
      <ul className="matchdest__legs">
        <li className="matchdest__leg matchdest__leg--me">
          <span className="matchdest__dot" aria-hidden="true" />
          <span>
            <strong>{t('Você')}</strong>
            <span className="muted">{me ? t('{time} · {distance}', { time: formatTravel(me.durationS), distance: formatDistance(me.distanceM) }) : t('Compartilhe sua localização para ver a rota')}</span>
          </span>
        </li>
        <li className="matchdest__leg matchdest__leg--them">
          <span className="matchdest__dot" aria-hidden="true" />
          <span>
            <strong>{other}</strong>
            <span className="muted">{them ? t('{time} · {distance}', { time: formatTravel(them.durationS), distance: formatDistance(them.distanceM) }) : t('Sem localização de {other} ainda', { other })}</span>
          </span>
        </li>
      </ul>
      <div className="row-actions">
        <OpenInMaps className="btn btn--primary btn--small" mode="route" lat={dest.lat} lng={dest.lng} label={dest.name} travel={mode === 'driving' ? 'driving' : 'walking'}>
          {t('Abrir minha rota no mapa')}
        </OpenInMaps>
        <Button small variant="quiet" loading={busy} onClick={onClear}>
          {t('Tirar lugar')}
        </Button>
      </div>
    </section>
  );
}
