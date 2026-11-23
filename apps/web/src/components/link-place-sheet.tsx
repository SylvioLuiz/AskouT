import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { ErrorState, Field, Loading } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import type { LinkedPlace } from '../lib/post-draft.ts';
import type { ExplorePlace } from '../lib/types.ts';
import { useCurrentPosition } from '../screens/explore.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Busca para vincular um rolê: locais do AskouT e qualquer lugar do Google pelo nome ou endereço, mesmo longe.
 * A posição (se liberada) só põe o que está perto primeiro; sem ela a busca funciona do mesmo jeito.
 */
function useLinkPlaceSearch(q: string) {
  const term = useDebounced(q.trim(), 350);
  const where = useCurrentPosition();
  const position = where.status === 'ok' ? where.position : undefined;
  const result = useAsync(
    () => (term.length >= 2 ? api.searchPlaces({ q: term, lat: position?.lat, lng: position?.lng }) : Promise.resolve(null)),
    [term, position?.lat, position?.lng],
  );
  return { term, result, places: result.data?.places ?? [] };
}

/** Escolher o lugar a vincular ao post (qualquer lugar, com ou sem foto, do AskouT ou do Google). */
export function LinkPlaceSheet({ onPick, onClose }: { onPick: (place: LinkedPlace) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<string | undefined>();
  const { term, result, places } = useLinkPlaceSearch(q);

  async function pick(p: ExplorePlace) {
    const base = { name: p.name, address: p.address, photo: p.photoPath ? { photoPath: p.photoPath, author: p.photoAuthor } : null };
    if (p.venue) return onPick({ ...base, venueId: p.venue.id });
    // Lugar que ainda não está no AskouT: cria o local a partir do Google e já vincula.
    setPicking(p.key);
    const venueId = await api
      .openExternalVenue({ key: p.key, lat: p.lat, lng: p.lng })
      .then((r) => r.venueId)
      .catch(() => null);
    setPicking(undefined);
    onPick({ ...base, venueId });
  }

  return (
    <Sheet title={t('Vincular um local')} onClose={onClose}>
      <Field label={t('Buscar local')} type="search" value={q} onChange={setQ} autoFocus autoComplete="off" hint={t('Nome ou endereço do lugar')} />
      {term.length < 2 ? <p className="muted">{t('Digite o nome ou o endereço do local.')}</p> : null}
      {result.loading && !result.data ? <Loading shape="rows" rows={3} /> : null}
      {result.error ? <ErrorState message={result.error.message} onRetry={result.reload} /> : null}
      {result.data && places.length === 0 ? <p className="muted">{result.data.placesAvailable ? t('Nenhum local encontrado.') : t('A busca de locais ainda não está ligada neste ambiente.')}</p> : null}
      <ul className="placepick">
        {places.map((p) => (
          <li key={p.key}>
            <button type="button" className="placepick__item" disabled={picking !== undefined} aria-busy={picking === p.key || undefined} onClick={() => void pick(p)}>
              <span>
                <strong>{p.name}</strong>
                {p.address ? <span className="muted"> {p.address}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {places.some((p) => p.source === 'GOOGLE') ? <p className="muted">{t('Resultados do Google.')}</p> : null}
    </Sheet>
  );
}
