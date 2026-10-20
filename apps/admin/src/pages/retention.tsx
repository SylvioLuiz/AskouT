import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { formatDate } from '../labels.ts';
import { pct, returnVerdict, seconds } from '../retention.ts';
import type { RetentionReport, ReturnGroup, ReturnRate } from '../types.ts';
import { Loadable, PageHead } from '../ui.tsx';

const PERIODS = [7, 14, 30, 60] as const;

function Rate({ r, min }: { r: ReturnRate; min: number }) {
  return (
    <>
      <strong>{pct(r.rate)}</strong>
      <span className="muted small"> {r.returned} de {r.sample}{r.sample < min ? ' · poucos dados' : ''}</span>
    </>
  );
}

function ReturnTable({ title, g, min }: { title: string; g: ReturnGroup; min: number }) {
  return (
    <>
      <h3 className="section">{title}</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Grupo</th>
            <th className="num">Voltaram</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Todos os dias com atividade</td><td className="num"><Rate r={g.all} min={min} /></td></tr>
          <tr><td>Dias em que a pessoa viu o bloco “Para você”</td><td className="num"><Rate r={g.withReco} min={min} /></td></tr>
          <tr><td>Dias em que não viu</td><td className="num"><Rate r={g.withoutReco} min={min} /></td></tr>
        </tbody>
      </table>
      <p className="muted small">{returnVerdict(g.withReco, g.withoutReco, min)}</p>
    </>
  );
}

function Report({ r }: { r: RetentionReport }) {
  const { FEED: feed, RECO: reco } = r.sources;
  return (
    <>
      {r.truncated ? <p className="notice notice--bad" role="alert">Havia dados demais: os mais antigos do período ficaram de fora.</p> : null}
      <p className="muted small">De {formatDate(`${r.from}T12:00:00-03:00`)} a {formatDate(`${r.to}T12:00:00-03:00`)} (horário de Brasília). Só entram pessoas que mantêm as recomendações personalizadas ligadas.</p>

      <h2 className="section">Bloco “Para você” contra o feed</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Medida</th>
            <th className="num">Feed</th>
            <th className="num">Para você</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Conteúdos mostrados (por pessoa e dia)</td><td className="num">{feed.impressions}</td><td className="num">{reco.impressions}</td></tr>
          <tr><td>Pessoas que viram</td><td className="num">{feed.users}</td><td className="num">{reco.users}</td></tr>
          <tr><td>Tempo médio na tela</td><td className="num">{seconds(feed.avgDwellMs)}</td><td className="num">{seconds(reco.avgDwellMs)}</td></tr>
          <tr><td>Abertos a partir dali</td><td className="num">{feed.clicks > 0 ? feed.clicks : '—'}</td><td className="num">{reco.clicks}</td></tr>
          <tr><td>Taxa de abertura</td><td className="num">{feed.clicks > 0 ? pct(feed.ctr) : '—'}</td><td className="num">{pct(reco.ctr)}</td></tr>
        </tbody>
      </table>
      <p className="muted small">O feed não registra abertura, só o bloco “Para você”. Por isso a taxa de abertura do feed aparece vazia.</p>

      <h2 className="section">Quem volta</h2>
      <p className="muted small">Para cada dia em que a pessoa usou o app, vemos se ela voltou 1 dia e 7 dias depois. Só contam dias cujo retorno já passou.</p>
      <ReturnTable title="Voltou no dia seguinte" g={r.d1} min={r.minSample} />
      <ReturnTable title="Voltou 7 dias depois" g={r.d7} min={r.minSample} />

      <h2 className="section">Dia a dia</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Dia</th>
            <th className="num">Pessoas ativas</th>
            <th className="num">Feed</th>
            <th className="num">Para você</th>
            <th className="num">Abertos</th>
            <th className="num">Tempo (para você)</th>
          </tr>
        </thead>
        <tbody>
          {[...r.daily].reverse().map((d) => (
            <tr key={d.day}>
              <td>{formatDate(`${d.day}T12:00:00-03:00`)}</td>
              <td className="num">{d.activeUsers}</td>
              <td className="num">{d.feedImpressions}</td>
              <td className="num">{d.recoImpressions}</td>
              <td className="num">{d.recoClicks}</td>
              <td className="num">{seconds(d.recoAvgDwellMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section">Como ler</h2>
      <ul className="muted small">
        <li>“Atividade” é ter tempo medido na tela naquele dia. Quem desligou as recomendações personalizadas não aparece (as medições dessa pessoa são apagadas), então os números subestimam o uso total.</li>
        <li>Quem viu o bloco e voltou mais não prova que o bloco causou isso. Para provar, seria preciso esconder o bloco de um grupo sorteado e comparar.</li>
        <li>Com poucas pessoas, as taxas oscilam muito. Abaixo de {r.minSample} dias-pessoa em algum grupo, trate como palpite.</li>
      </ul>
    </>
  );
}

export function RetentionPage() {
  const [days, setDays] = useState<number>(14);
  const state = useAsync(() => api.retention(days), [days]);
  return (
    <>
      <PageHead title="Retenção" hint="O bloco “Para você” está funcionando? Compara o bloco com o feed e mostra quem volta.">
        <div className="seg" role="group" aria-label="Período">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={p === days ? 'btn btn--primary' : 'btn'} aria-pressed={p === days} onClick={() => setDays(p)}>
              {p} dias
            </button>
          ))}
        </div>
      </PageHead>
      <Loadable state={state} empty="Sem dados." isEmpty={() => false}>{(r) => <Report r={r} />}</Loadable>
    </>
  );
}
