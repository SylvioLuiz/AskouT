import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { Button, ErrorState, Field, Loading } from './ui.tsx';
import { PlaceSearchMore } from './place-search-more.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import type { LinkedPlace } from '../lib/post-draft.ts';
import type { ExplorePlace } from '../lib/types.ts';
import { useCurrentPosition } from '../screens/explore.tsx';
import { t } from '../lib/i18n/index.ts';
import { HOUSE_NUMBER_RE, numberFromQuery, streetAddress } from '../lib/street-address.ts';

/**
 * Busca para vincular um rolê: locais do AskouT e qualquer lugar do Google pelo nome ou endereço, mesmo longe.
 * A posição (se liberada) só põe o que está perto primeiro; sem ela a busca funciona do mesmo jeito.
 */
function useLinkPlaceSearch(q: string) {
  const term = useDebounced(q.trim(), 350);
  const where = useCurrentPosition();
  const position = where.status === 'ok' ? where.position : undefined;
  // "Buscar mais no Google" vale só para o texto em que foi apertado; mudou o texto, volta à busca gratuita.
  const [googleFor, setGoogleFor] = useState<string | null>(null);
  const google = googleFor === term;
  const result = useAsync(
    () => (term.length >= 2 ? api.searchPlaces({ q: term, lat: position?.lat, lng: position?.lng, google }) : Promise.resolve(null)),
    [term, position?.lat, position?.lng, google],
  );
  return { term, result, places: result.data?.places ?? [], google, searchGoogle: () => setGoogleFor(term) };
}

/** Escolher o lugar a vincular ao post (qualquer lugar, com ou sem foto, do AskouT ou do Google). */
export function LinkPlaceSheet({ onPick, onClose }: { onPick: (place: LinkedPlace) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<string | undefined>();
  // Rua escolhida (resultado sem número): antes de vincular, a pessoa informa o número e, se quiser, o complemento.
  const [street, setStreet] = useState<ExplorePlace | null>(null);
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [numberError, setNumberError] = useState<string | undefined>();
  const { term, result, places, google, searchGoogle } = useLinkPlaceSearch(q);

  async function open(p: ExplorePlace, houseNumber?: string): Promise<string | null> {
    setPicking(p.key);
    const venueId = await api
      .openExternalVenue({ key: p.key, lat: p.lat, lng: p.lng, ...(houseNumber ? { number: houseNumber } : {}) })
      .then((r) => r.venueId)
      .catch(() => null);
    setPicking(undefined);
    return venueId;
  }

  async function pick(p: ExplorePlace) {
    const base = { name: p.name, address: p.address, photo: p.photoPath ? { photoPath: p.photoPath, author: p.photoAuthor } : null };
    if (p.venue) return onPick({ ...base, venueId: p.venue.id });
    if (p.street) {
      setStreet(p);
      setNumber(numberFromQuery(q, p.name));
      setComplement('');
      setNumberError(undefined);
      return;
    }
    // Lugar que ainda não está no AskouT: cria o local a partir do Google ou do OpenStreetMap e já vincula.
    onPick({ ...base, venueId: await open(p) });
  }

  async function confirmStreet(withNumber: boolean) {
    if (!street) return;
    if (!withNumber) return onPick({ name: street.name, address: street.address, photo: null, venueId: await open(street) });
    const n = number.trim().replace(/\s+/g, '').toUpperCase();
    if (!HOUSE_NUMBER_RE.test(n)) return setNumberError(t('Informe o número (ex.: 123).'));
    const { name, address } = streetAddress(street, n, complement);
    onPick({ name, address, photo: null, venueId: await open(street, n) });
  }

  if (street) {
    return (
      <Sheet title={t('Número do endereço')} onClose={onClose}>
        <p>
          <strong>{street.name}</strong>
          {street.address ? <span className="muted"> {street.address}</span> : null}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirmStreet(true);
          }}
        >
          <Field
            label={t('Número')}
            value={number}
            onChange={(v) => {
              setNumber(v);
              setNumberError(undefined);
            }}
            autoFocus
            autoComplete="off"
            maxLength={10}
            placeholder={t('Ex.: 123')}
            error={numberError}
          />
          <Field label={t('Complemento (opcional)')} value={complement} onChange={setComplement} autoComplete="off" maxLength={60} placeholder={t('Ex.: apto 12, bloco B, fundos')} />
          <div className="row-actions">
            <Button variant="quiet" disabled={picking !== undefined} onClick={() => setStreet(null)}>
              {t('Voltar')}
            </Button>
            <Button type="submit" loading={picking !== undefined}>
              {t('Usar este endereço')}
            </Button>
          </div>
        </form>
        <Button variant="quiet" small disabled={picking !== undefined} onClick={() => void confirmStreet(false)}>
          {t('Usar só a rua, sem número')}
        </Button>
      </Sheet>
    );
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
      <PlaceSearchMore data={result.data} google={google} busy={result.loading || picking !== undefined} onGoogle={searchGoogle} />
    </Sheet>
  );
}
