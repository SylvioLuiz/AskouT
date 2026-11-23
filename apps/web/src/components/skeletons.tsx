import type { CSSProperties } from 'react';
import { BoltIcon, ChevronLeftIcon, HelpIcon } from './icons.tsx';
import { Loading, PageHeadSkeleton } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

// Esqueletos de telas inteiras. Cada um usa as classes da tela pronta (o mesmo cabeçalho, a mesma capa, as mesmas
// colunas), só que com barras cinzas no lugar do conteúdo, para nada pular de lugar quando os dados chegam.

const line = (width: string, extra = '', style?: CSSProperties) => <span className={`skeleton__line${extra ? ` ${extra}` : ''}`} style={{ width, ...style }} />;
const bone = (className: string, style?: CSSProperties) => <span className={`skeleton__bone ${className}`} style={style} />;

function Status({ label }: { label: string }) {
  return <span className="visually-hidden">{label}…</span>;
}

/** Perfil (o seu e o dos outros): foto à esquerda com nome e @, os três números, os botões (só no dos outros), as abas e os cartões de evento. */
export function ProfileSkeleton({ self }: { self: boolean }) {
  return (
    <div className="profilepage" role="status" aria-live="polite">
      <Status label={t('Carregando perfil')} />
      <div className="profilepage__side" aria-hidden="true">
        <header className="profile">
          <span className="skeleton__avatar skeleton__avatar--big" />
          <div className="profile__id skelgrow">
            {line('70%', 'skeleton__line--title')}
            {line('45%', '', { marginTop: 10 })}
          </div>
        </header>
        <p className="profile__counts">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skelstat">
              {line('28px', 'skeleton__line--strong')}
              {line('64px')}
            </span>
          ))}
        </p>
        {self ? null : (
          <div className="profile__actions">
            {bone('skeleton__wide skelgrow')}
            {bone('skeleton__wide skelgrow')}
            {bone('skeleton__wide', { flex: 'none', width: 40 })}
          </div>
        )}
      </div>
      <div className="profilepage__main" aria-hidden="true">
        <div className="skeltabs">{(self ? [0, 1, 2] : [0, 1]).map((i) => <span key={i}>{line('100%')}</span>)}</div>
        <Loading shape="tiles" rows={2} />
      </div>
    </div>
  );
}

/** NOW: o cabeçalho de verdade (título e "Como funciona?"), o radar, o recado, a duração e o botão de ligar. */
export function NowSkeleton({ onHow }: { onHow: () => void }) {
  return (
    <section className="nowoff" role="status" aria-live="polite">
      <Status label={t('Carregando o NOW')} />
      <header className="nowhead">
        <div>
          <h1 className="nowhead__title">
            NOW <BoltIcon filled />
          </h1>
          <div className="skelcol" aria-hidden="true">
            {line('92%')}
            {line('76%')}
            {line('54%')}
          </div>
        </div>
        <button type="button" className="nowhead__how" onClick={onHow}>
          <HelpIcon />
          {t('Como funciona?')}
        </button>
      </header>
      <div className="nowradar skelradar" aria-hidden="true">
        <span className="skelradar__ring">
          <span className="skeleton__avatar" />
        </span>
      </div>
      <div className="skelcenter" aria-hidden="true">
        {bone('skeleton__input', { width: '70%', height: 40 })}
      </div>
      {bone('skeleton__wide', { height: 52 })}
      {bone('skeleton__wide', { height: 52, borderRadius: 999 })}
    </section>
  );
}

/** Página do evento: a capa com voltar, selo, título e local; os três números; os botões e a fileira de ações redondas. */
export function EventSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <article className="evpage" role="status" aria-live="polite">
      <Status label={t('Carregando o evento')} />
      <section className="evhero skelhero">
        <button type="button" className="evhero__btn evhero__btn--back" onClick={onBack} aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </button>
        <div className="evhero__body" aria-hidden="true">
          <span className="skeleton__avatar skelcircle" style={{ width: 52, height: 52 }} />
          <span className="skelpills">
            {bone('skelpill')}
            {bone('skelpill')}
          </span>
          {line('72%', 'skeleton__line--title')}
          {line('48%')}
        </div>
      </section>
      <div className="evpage__main" aria-hidden="true">
        <span className="skelflash">
          <span className="skeleton__avatar" style={{ width: 64, height: 64 }} />
          {line('52px')}
        </span>
        <dl className="evstats">
          {[0, 1, 2].map((i) => (
            <div key={i} className="evstats__cell">
              {line('64px')}
              {line('48px', 'skeleton__line--title', { marginTop: 4 })}
              {line('40px', '', { marginTop: 4 })}
            </div>
          ))}
        </dl>
        <div className="evgo">
          {bone('skeleton__wide skelgrow', { height: 50 })}
          {bone('skeleton__wide skelgrow', { height: 50 })}
        </div>
        <div className="skelround">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i}>
              <span className="skeleton__avatar" />
              {line('40px')}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

/** Página do local: a capa com logo, nome, lugar e a faixa de números; depois os botões e as abas. */
export function VenueSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="vpage" role="status" aria-live="polite">
      <Status label={t('Carregando o local')} />
      <div className="vpage__side">
        <header className="vhero skelhero">
          <button type="button" className="vhero__back" onClick={onBack} aria-label={t('Voltar')}>
            <ChevronLeftIcon />
          </button>
          <div className="vhero__body" aria-hidden="true">
            <span className="skeleton__avatar skelcircle" style={{ width: 104, height: 104 }} />
            {line('60%', 'skeleton__line--title', { marginTop: 4 })}
            {line('22%')}
            {line('38%')}
          </div>
          <dl className="vstats" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="vstat skelstat">
                {line('24px', 'skeleton__line--strong')}
                {line('64px')}
              </div>
            ))}
          </dl>
        </header>
        <div className="vhead" aria-hidden="true">
          <div className="skelrow">
            {bone('skeleton__wide')}
            {bone('skeleton__wide', { flex: 'none', width: 44 })}
            {bone('skeleton__wide')}
          </div>
        </div>
      </div>
      <div className="vpage__main" aria-hidden="true">
        <div className="skeltabs">{[0, 1, 2, 3].map((i) => <span key={i}>{line('100%')}</span>)}</div>
        <Loading shape="cards" rows={2} />
      </div>
    </div>
  );
}

/**
 * Informações da conversa e do grupo: o cabeçalho da página, a foto grande no meio com nome (e @ na conversa a dois),
 * as abas e, no grupo, a lista de participantes.
 */
export function ChatInfoSkeleton({ title, back, group = false }: { title?: string; back: string; group?: boolean }) {
  return (
    <div role="status" aria-live="polite">
      <Status label={t('Carregando informações')} />
      <PageHeadSkeleton {...(title ? { title } : {})} back={back} subtitle={group} />
      <div className="chatinfo chatinfo--stack skelcenter" aria-hidden="true">
        <span className="skeleton__avatar" style={{ width: 96, height: 96 }} />
        {group ? null : (
          <>
            {line('140px', 'skeleton__line--strong')}
            {line('90px')}
          </>
        )}
      </div>
      <div aria-hidden="true">
        <div className="skeltabs">{(group ? [0, 1, 2, 3] : [0, 1, 2]).map((i) => <span key={i}>{line('100%')}</span>)}</div>
        {group ? <Loading shape="list" rows={5} /> : <Loading shape="lines" rows={2} />}
      </div>
    </div>
  );
}

/** Post aberto sozinho: o cabeçalho "Post" e o cartaz arredondado com a foto, como na tela pronta. */
export function PostPageSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <Status label={t('Carregando o post')} />
      <PageHeadSkeleton title={t('Post')} back="/" />
      <div aria-hidden="true">{bone('skelposter')}</div>
    </div>
  );
}
