import { Button, Loading, Notice } from './ui.tsx';
import { formatDistance, formatTravel, placeName } from '../lib/flash.ts';
import { routeLink } from '../lib/chat.ts';
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
}

/** Lista dos lugares entre os dois, numerados como os pins do mapa. Tocar seleciona; "Escolher" avisa a outra pessoa. */
export function MatchPlaces({ bothShared, loading, error, suggestions, places, otherName, selectedKey, busy, onSelect, onChoose }: PlacesProps) {
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
      {loading && !suggestions ? <Loading label={t('Buscando rolês')} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {suggestions?.reason === 'TOO_FAR' ? <Notice>{t('Vocês estão longe demais um do outro para achar algo no meio do caminho.')}</Notice> : null}
      {suggestions && suggestions.reason === null && places.length === 0 ? <p className="muted">{t('Nenhum evento ou rolê encontrado por perto agora.')}</p> : null}
      {places.length > 0 ? (
        <>
          <p className="muted">{t('Toque em um lugar para ver no mapa e escolha onde se encontrar.')}</p>
          <ol className="matchplaces__list">
            {places.map((item, index) => {
              const selected = item.key === selectedKey;
              return (
                <li key={item.key} className={`mplace${selected ? ' is-selected' : ''}`}>
                  <button type="button" className="mplace__main" aria-pressed={selected} onClick={() => onSelect(item.key)}>
                    <span className="mplace__num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="mplace__text">
                      <strong>{placeName(item)}</strong>
                      {item.title !== placeName(item) ? <span className="muted">{item.title}</span> : null}
                      <span className="muted">{t('a {me} de você · {them} de {otherName}', { me: formatDistance(item.distanceFromMeM), them: formatDistance(item.distanceFromThemM), otherName })}</span>
                    </span>
                  </button>
                  {selected ? (
                    <Button small loading={busy} onClick={() => onChoose(item)}>
                      {t('Escolher este lugar')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {suggestions && !suggestions.placesAvailable ? <p className="muted">{t('Não foi possível buscar rolês agora. Mostrando só eventos do AskouT.')}</p> : null}
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
      <p className="muted">{dest.chosenByMe ? t('Você escolheu este lugar. {other} foi avisado.', { other }) : t('{other} escolheu este lugar. Você pode escolher outro.', { other })}</p>
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
        <a className="btn btn--primary btn--small" href={mode === 'driving' ? routeLink(dest.lat, dest.lng).replace('walking', 'driving') : routeLink(dest.lat, dest.lng)} target="_blank" rel="noopener noreferrer">
          {t('Abrir minha rota no mapa')}
        </a>
        <Button small variant="quiet" loading={busy} onClick={onClear}>
          {t('Tirar lugar')}
        </Button>
      </div>
    </section>
  );
}
