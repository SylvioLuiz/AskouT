import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';
import type { BoostPhase, BoostReport, BoostStatValue } from '../lib/types.ts';
import { Button, ErrorState, Loading } from './ui.tsx';

/** Só anúncios que já foram ao ar têm resultado. */
export function hasResults(phase: BoostPhase): boolean {
  return phase === 'ACTIVE' || phase === 'ENDED' || phase === 'PAUSED';
}

const PLACEMENT_LABEL: Record<BoostReport['placements'][number]['placement'], string> = {
  EXPLORE: 'Explorar',
  HOME: 'Home (Rolês em destaque)',
  MATCH: 'Para você (Match)',
  EVENT_PAGE: 'Página do evento',
};

function num(value: BoostStatValue): string {
  return value === null ? t('menos de 10') : value.toLocaleString(intlLocale());
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
  return date.toLocaleDateString(intlLocale(), { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bres__tile">
      <span className="bres__label">{label}</span>
      <strong className="bres__value">{value}</strong>
      {hint ? <span className="bres__hint">{hint}</span> : null}
    </div>
  );
}

/** Exibições por dia: uma série só, barra por dia, número ao tocar/passar o mouse e a tabela logo abaixo. */
function DailyBars({ report }: { report: BoostReport }) {
  const [focus, setFocus] = useState<number | undefined>(undefined);
  const values = report.days.map((d) => d.impressions ?? 0);
  const max = Math.max(1, ...values);
  if (report.days.length === 0) return null;
  const shown = focus === undefined ? undefined : report.days[focus];
  return (
    <figure className="bres__chart">
      <figcaption className="bres__caption">
        {shown ? t('{day}: {n} exibições', { day: dayLabel(shown.day), n: num(shown.impressions) }) : t('Exibições por dia')}
      </figcaption>
      <div className="bres__bars" role="img" aria-label={t('Exibições por dia; os números estão na tabela abaixo')} onMouseLeave={() => setFocus(undefined)}>
        {report.days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            className={`bres__col${focus === i ? ' bres__col--on' : ''}`}
            onMouseEnter={() => setFocus(i)}
            onFocus={() => setFocus(i)}
            onClick={() => setFocus(focus === i ? undefined : i)}
            aria-label={t('{day}: {n} exibições', { day: dayLabel(d.day), n: num(d.impressions) })}
          >
            <span className="bres__bar" style={{ height: `${Math.max(d.impressions ? 4 : 0, Math.round(((d.impressions ?? 0) / max) * 100))}%` }} />
          </button>
        ))}
      </div>
      <div className="bres__axis" aria-hidden="true">
        <span>{dayLabel(report.days[0]!.day)}</span>
        {report.days.length > 1 ? <span>{dayLabel(report.days[report.days.length - 1]!.day)}</span> : null}
      </div>
    </figure>
  );
}

function ReportBody({ report }: { report: BoostReport }) {
  const empty = report.totals.impressions === 0;
  return (
    <div className="bres">
      <div className="bres__tiles">
        <Tile label={t('Exibições')} value={num(report.totals.impressions)} hint={t('pessoas por dia')} />
        <Tile label={t('Aberturas')} value={num(report.totals.opens)} hint={report.openRatePct === null ? undefined : t('{pct}% de quem viu', { pct: report.openRatePct })} />
        <Tile label={t('Ingresso')} value={num(report.totals.ticketClicks)} hint={t('foram ao site de venda')} />
      </div>
      {empty ? <p className="boost__hint">{t('Ainda sem exibições. Os números aparecem aqui conforme as pessoas veem o anúncio.')}</p> : <DailyBars report={report} />}
      {report.placements.length > 0 ? (
        <>
          <h3 className="boost__sub">{t('Onde foi visto')}</h3>
          <ul className="bres__places">
            {report.placements.map((p) => (
              <li key={p.placement}>
                <span>{t(PLACEMENT_LABEL[p.placement])}</span>
                <strong>{num(p.impressions)}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!empty ? (
        <details className="bres__table">
          <summary>{t('Ver dia a dia')}</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('Dia')}</th>
                <th scope="col">{t('Exibições')}</th>
                <th scope="col">{t('Aberturas')}</th>
                <th scope="col">{t('Ingresso')}</th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{dayLabel(d.day)}</th>
                  <td>{num(d.impressions)}</td>
                  <td>{num(d.opens)}</td>
                  <td>{num(d.ticketClicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      <p className="bres__note">
        {t('Cada pessoa conta uma vez por dia em cada número. Ingresso conta só quem viu o anúncio no mesmo dia ou no anterior. Ninguém é identificado.')}
        {report.rounded ? ` ${t('No Match os números são arredondados de 10 em 10.')}` : ''}
      </p>
    </div>
  );
}

/** Botão "Ver resultados" no pedido e o relatório aberto logo abaixo. */
export function BoostResults({ boostId }: { boostId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button small variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('Esconder resultados') : t('Ver resultados')}
      </Button>
      {open ? <ReportLoader boostId={boostId} /> : null}
    </>
  );
}

function ReportLoader({ boostId }: { boostId: string }) {
  const report = useAsync(() => api.boostReport(boostId), [boostId]);
  if (report.loading) return <Loading />;
  if (report.error || !report.data) return <ErrorState message={report.error?.message ?? t('Não foi possível carregar.')} onRetry={report.reload} />;
  return <ReportBody report={report.data} />;
}
