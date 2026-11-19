import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { formatDate, formatDateTime } from '../labels.ts';
import { experimentVerdict, pct, returnVerdict, seconds } from '../retention.ts';
import type { ExperimentReport, GroupReturn, RecoExperimentState, RetentionReport, ReturnGroup, ReturnRate } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

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

/** Chave e tamanho do grupo de controle do teste A/B. Vale na hora; cada mudança fica na Auditoria. */
function ExperimentSwitch({ onChanged }: { onChanged: () => void }) {
  const state = useAsync(() => api.recoExperiment(), []);
  const [action, setAction] = useState<ActionSpec>();
  const [percent, setPercent] = useState<number>();

  function apply(s: RecoExperimentState, enabled: boolean, controlPercent: number) {
    const changing = enabled && s.enabled;
    setAction({
      title: !enabled ? 'Desligar o teste A/B' : changing ? 'Mudar o tamanho do controle' : 'Ligar o teste A/B',
      description: (
        <>
          {enabled ? (
            <p>{controlPercent}% das pessoas (sorteadas de forma fixa) deixam de ver o bloco “Para você” na Home. Os anúncios Match e os rolês em destaque continuam para todos.</p>
          ) : (
            <p>Todo mundo volta a ver o bloco. As pessoas do controle continuam as mesmas se você religar depois.</p>
          )}
          {changing ? <p className="muted small">Com o teste no ar, mudar o tamanho faz algumas pessoas trocarem de grupo, então a comparação recomeça deste momento.</p> : null}
        </>
      ),
      confirmLabel: !enabled ? 'Desligar' : changing ? 'Mudar tamanho' : 'Ligar teste',
      danger: !enabled,
      noteLabel: 'Motivo',
      run: (note) => api.setRecoExperiment(enabled, controlPercent, note),
    });
  }

  return (
    <Loadable state={state} empty="Sem dados." isEmpty={() => false}>
      {(s) => {
        const value = percent ?? s.controlPercent;
        const valid = Number.isInteger(value) && value >= 1 && value <= s.maxPercent;
        return (
          <div className="card" style={{ maxWidth: 560 }}>
            <span className="card__label">Teste A/B do bloco “Para você”</span>
            <p style={{ margin: '4px 0' }}>
              <Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? `Ligado · ${s.controlPercent}% sem o bloco` : 'Desligado'}</Badge>
            </p>
            <p className="muted small">
              {s.enabled ? 'O grupo de controle não vê o bloco na Home. ' : 'Todo mundo vê o bloco. '}
              {s.startedAt ? <>Medição desde {formatDateTime(s.startedAt)}{s.endedAt ? <> até {formatDateTime(s.endedAt)}</> : null}.</> : 'Nunca foi ligado.'}
              {s.updatedBy ? <> Última mudança por <strong>@{s.updatedBy}</strong>.</> : null}
            </p>
            <div className="field">
              <label htmlFor="reco-exp-pct">Tamanho do controle (1 a {s.maxPercent}%)</label>
              <input id="reco-exp-pct" type="number" min={1} max={s.maxPercent} step={1} value={value} onChange={(e) => setPercent(Number(e.target.value))} />
            </div>
            <div>
              {s.enabled ? (
                <>
                  <button type="button" className="btn btn--primary" disabled={!valid || value === s.controlPercent} onClick={() => apply(s, true, value)}>Mudar tamanho</button>{' '}
                  <button type="button" className="btn btn--danger" onClick={() => apply(s, false, s.controlPercent)}>Desligar teste</button>
                </>
              ) : (
                <button type="button" className="btn btn--primary" disabled={!valid} onClick={() => apply(s, true, value)}>Ligar teste</button>
              )}
            </div>
            {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={() => { setPercent(undefined); state.reload(); onChanged(); }} /> : null}
          </div>
        );
      }}
    </Loadable>
  );
}

function GroupRow({ label, g, min }: { label: string; g: GroupReturn; min: number }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{g.users}</td>
      <td className="num"><Rate r={g.d1} min={min} /></td>
      <td className="num"><Rate r={g.d7} min={min} /></td>
    </tr>
  );
}

const thin = (a: ReturnRate, b: ReturnRate, min: number) => a.sample < min || b.sample < min;

function ExperimentSection({ e }: { e: ExperimentReport }) {
  return (
    <>
      <h2 className="section">Teste A/B: com e sem o bloco</h2>
      <p className="muted small">
        {e.enabled ? 'Em andamento' : 'Encerrado'}, de {formatDate(`${e.from}T12:00:00-03:00`)} a {formatDate(`${e.to}T12:00:00-03:00`)}, com {e.controlPercent}% das pessoas no controle (sem o bloco). Cada pessoa conta uma vez, a partir do primeiro dia ativo dela no período.
      </p>
      {e.lowData ? <p className="notice notice--warn">Poucos dados: algum grupo tem menos de {e.minSample} pessoas com retorno já medido. Trate como palpite.</p> : null}
      <table className="table">
        <thead>
          <tr>
            <th>Grupo</th>
            <th className="num">Pessoas ativas</th>
            <th className="num">Voltou em 1 dia</th>
            <th className="num">Voltou em 7 dias</th>
          </tr>
        </thead>
        <tbody>
          <GroupRow label="Controle (sem o bloco)" g={e.control} min={e.minSample} />
          <GroupRow label="Tratamento (com o bloco)" g={e.treatment} min={e.minSample} />
        </tbody>
      </table>
      <p className="muted small"><strong>1 dia:</strong> {experimentVerdict(e.d1Diff, thin(e.treatment.d1, e.control.d1, e.minSample), e.minSample)}</p>
      <p className="muted small"><strong>7 dias:</strong> {experimentVerdict(e.d7Diff, thin(e.treatment.d7, e.control.d7, e.minSample), e.minSample)}</p>
      <p className="muted small">Atividade aqui é o tempo medido no feed (Home, Explorar, posts de um local), nunca o do bloco “Para você”: o controle não vê o bloco e ficaria com menos atividade só por isso. Como o tempo na tela só é medido de quem mantém as recomendações personalizadas ligadas, o teste vale para essas pessoas.</p>
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
          <tr><td>Abertos a partir dali</td><td className="num">{feed.clicks}</td><td className="num">{reco.clicks}</td></tr>
          <tr><td>Taxa de abertura</td><td className="num">{pct(feed.ctr)}</td><td className="num">{pct(reco.ctr)}</td></tr>
        </tbody>
      </table>
      <p className="muted small">Abertura é tocar num post ou evento e ir para a página dele. Vale para o feed da Home, o Explorar e os posts de um local. Cliques só passaram a ser gravados no feed depois desta versão; dias anteriores mostram 0 e não servem de comparação.</p>

      <h2 className="section">Quem volta</h2>
      <p className="muted small">Para cada dia em que a pessoa usou o app, vemos se ela voltou 1 dia e 7 dias depois. Só contam dias cujo retorno já passou.</p>
      <ReturnTable title="Voltou no dia seguinte" g={r.d1} min={r.minSample} />
      <ReturnTable title="Voltou 7 dias depois" g={r.d7} min={r.minSample} />

      {r.experiment ? <ExperimentSection e={r.experiment} /> : null}

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
        <li>Quem viu o bloco e voltou mais não prova que o bloco causou isso. Para provar, esconda o bloco de um grupo sorteado e compare: é o teste A/B (ligue no cartão no topo da página).</li>
        <li>Com poucas pessoas, as taxas oscilam muito. Abaixo de {r.minSample} dias-pessoa em algum grupo, trate como palpite.</li>
      </ul>
    </>
  );
}

export function RetentionPage() {
  const [days, setDays] = useState<number>(14);
  const [version, setVersion] = useState(0);
  const state = useAsync(() => api.retention(days), [days, version]);
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
      <ExperimentSwitch onChanged={() => setVersion((v) => v + 1)} />
      <Loadable state={state} empty="Sem dados." isEmpty={() => false}>{(r) => <Report r={r} />}</Loadable>
    </>
  );
}
