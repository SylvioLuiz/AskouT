import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { Button, Notice } from './ui.tsx';
import { formatDistance } from '../lib/flash.ts';
import { t } from '../lib/i18n/index.ts';
import { toApiError } from '../lib/errors.ts';
import type { ExplorePlace, PlaceSearchResult } from '../lib/types.ts';
import { PlaceSearchMore } from './place-search-more.tsx';

const MIN_CHARS = 2;

interface Props {
  /** Ponto de referência da busca (sua posição ou o meio do caminho). */
  center: { lat: number; lng: number } | undefined;
  otherName: string;
  busy: boolean;
  /** Já começa com a busca aberta. */
  startOpen?: boolean;
  onSuggest: (place: ExplorePlace) => void;
}

/** "Sugerir outro lugar", no mapa do chat: pesquisa qualquer bar, restaurante ou local pelo nome e manda como sugestão na conversa. */
export function MatchPlaceSearch({ center, otherName, busy, startOpen = false, onSuggest }: Props) {
  const [open, setOpen] = useState(startOpen);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ExplorePlace[] | undefined>();
  const [data, setData] = useState<PlaceSearchResult | undefined>();
  // "Buscar mais no Google" vale só para o texto em que foi apertado.
  const [googleFor, setGoogleFor] = useState<string | null>(null);
  const google = googleFor !== null && googleFor === q.trim();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const text = q.trim();
    if (!open || text.length < MIN_CHARS) {
      setResults(undefined);
      setData(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        // Sem limite de distância: qualquer lugar pelo nome ou endereço (os mais perto de vocês aparecem primeiro).
        .searchPlaces({ q: text, ...(center ? { lat: center.lat, lng: center.lng } : {}), google })
        .then((r) => {
          if (cancelled) return;
          setResults(r.places);
          setData(r);
          setError(undefined);
        })
        .catch((failure: unknown) => {
          if (!cancelled) setError(toApiError(failure).message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, open, center?.lat, center?.lng, google]);

  if (!open) {
    return (
      <div className="placesearch placesearch--closed">
        <Button variant="secondary" full onClick={() => setOpen(true)}>
          {t('Sugerir outro lugar')}
        </Button>
      </div>
    );
  }

  return (
    <section className="placesearch" aria-label={t('Sugerir outro lugar')}>
      <div className="placesearch__head">
        <h2 className="matchplaces__h">{t('Sugerir outro lugar')}</h2>
        <button type="button" className="linkbtn" onClick={() => setOpen(false)}>
          {t('Fechar')}
        </button>
      </div>
      <p className="muted">{t('Pesquise qualquer lugar, mesmo fora do caminho. {name} recebe um aviso com a sua sugestão.', { name: otherName })}</p>
      <input
        className="field__input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoFocus
        placeholder={t('Nome do bar, restaurante ou lugar')}
        aria-label={t('Nome do lugar')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading ? <p className="muted">{t('Buscando…')}</p> : null}
      {!loading && results && results.length === 0 ? <p className="muted">{t('Nada encontrado com esse nome por aqui.')}</p> : null}
      {results && results.length > 0 ? (
        <ul className="placesearch__list">
          {results.map((p) => (
            <li key={p.key} className="placesearch__item">
              <span className="placesearch__text">
                <strong>{p.name}</strong>
                <span className="muted">{[p.address, p.distanceM !== null ? formatDistance(p.distanceM) : null].filter(Boolean).join(' · ')}</span>
              </span>
              <Button small disabled={busy} onClick={() => onSuggest(p)}>
                {t('Sugerir')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <PlaceSearchMore data={data} google={google} busy={loading} onGoogle={() => setGoogleFor(q.trim())} />
    </section>
  );
}
