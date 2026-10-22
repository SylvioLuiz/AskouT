import type { ReactNode } from 'react';

type Signal = 'ok' | 'warn' | 'bad' | 'wait';

// Exemplo ilustrativo do que o produto mostra: para cada dia, quantos do grupo podem sair.
const WEEK: { day: string; signal: Signal; height: number }[] = [
  { day: 'seg', signal: 'bad', height: 34 },
  { day: 'ter', signal: 'warn', height: 62 },
  { day: 'qua', signal: 'wait', height: 48 },
  { day: 'qui', signal: 'ok', height: 100 },
  { day: 'sex', signal: 'warn', height: 70 },
  { day: 'sáb', signal: 'ok', height: 92 },
  { day: 'dom', signal: 'bad', height: 28 },
];

const LEGEND: { signal: Signal; label: string }[] = [
  { signal: 'ok', label: 'Todos podem' },
  { signal: 'warn', label: 'A maioria pode' },
  { signal: 'bad', label: 'Poucos podem' },
  { signal: 'wait', label: 'Faltam respostas' },
];

function WeekStrip() {
  return (
    <figure className="week">
      <div className="week__bars" role="img" aria-label="Exemplo: gráfico de uma semana com os dias em que um grupo de amigos pode sair">
        {WEEK.map((entry, index) => (
          <div key={entry.day} className="week__col">
            <div className="week__track">
              <div className={`week__bar week__bar--${entry.signal}`} style={{ height: `${entry.height}%`, animationDelay: `${120 + index * 70}ms` }} />
            </div>
            <span className="week__day">{entry.day}</span>
          </div>
        ))}
      </div>
      <figcaption className="week__caption">
        <span className="week__example">Exemplo</span>
        <ul className="week__legend">
          {LEGEND.map((item) => (
            <li key={item.signal}>
              <span className={`dot dot--${item.signal}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth__hero">
        <img className="auth__logo" src="/logo.png" alt="AskouT" width="120" height="120" />
        <h1 className="auth__headline">Menos tempo combinando. Mais tempo juntos.</h1>
        <p className="auth__lead">Veja em que dia você e seus amigos podem sair juntos, sem trocar vinte mensagens para descobrir.</p>
        <WeekStrip />
      </section>
      <section className="auth__panel">{children}</section>
    </div>
  );
}
