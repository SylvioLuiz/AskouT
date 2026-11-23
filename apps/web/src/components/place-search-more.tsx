import { Button } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';
import type { PlaceSearchResult } from '../lib/types.ts';

/**
 * Rodapé da busca de lugar pelo nome: crédito das fontes e o botão "Buscar mais no Google". A busca normal usa o AskouT
 * e o OpenStreetMap (grátis); o Google cobra por busca, por isso só entra quando a pessoa pede.
 */
export function PlaceSearchMore({ data, google, busy, onGoogle }: { data: PlaceSearchResult | null | undefined; google: boolean; busy?: boolean; onGoogle: () => void }) {
  if (!data) return null;
  const fromGoogle = data.places.some((p) => p.source === 'GOOGLE');
  const fromOsm = data.places.some((p) => p.source === 'OSM');
  return (
    <>
      {data.canSearchGoogle && !google ? (
        <Button variant="secondary" small disabled={busy} onClick={onGoogle}>
          {t('Buscar mais no Google')}
        </Button>
      ) : null}
      {fromGoogle ? <p className="muted">{t('Resultados do Google.')}</p> : null}
      {fromOsm ? <p className="muted">{t('Resultados do OpenStreetMap.')}</p> : null}
    </>
  );
}
