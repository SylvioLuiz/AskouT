import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { Button, Notice } from './ui.tsx';
import { formatDistance } from '../lib/flash.ts';
import { t } from '../lib/i18n/index.ts';
import { toApiError } from '../lib/errors.ts';
import type { ExplorePlace } from '../lib/types.ts';

/** Busca até 50 km em volta de quem pesquisa: dá para sugerir um rolê fora do meio do caminho. */
const SEARCH_RADIUS_KM = 50;
const MIN_CHARS = 2;

interface Props {
  /** Ponto de referência da busca (sua posição ou o meio do caminho). */
  center: { lat: number; lng: number } | undefined;
  otherName: string;
  busy: boolean;
  onSuggest: (place: { name: string; lat: number; lng: number }) => void;
}

/** "Sugerir outro lugar": pesquisa qualquer bar, restaurante ou local pelo nome e manda como destino do encontro. */
export function MatchPlaceSearch({ center, otherName, busy, onSuggest }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ExplorePlace[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const text = q.trim();
    if (!open || text.length < MIN_CHARS) {
      setResults(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api
        .explore({ q: text, ...(center ? { lat: center.lat, lng: center.lng, radiusKm: SEARCH_RADIUS_KM } : {}) })
        .then((r) => {
          if (cancelled) return;
          setResults(r.places);
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
  }, [q, open, center?.lat, center?.lng]);

  if (!open) {
    return (
      <Button variant="secondary" full onClick={() => setOpen(true)}>
        {t('Sugerir outro lugar')}
      </Button>
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
              <Button small disabled={busy} onClick={() => onSuggest({ name: p.name, lat: p.lat, lng: p.lng })}>
                {t('Sugerir')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
