import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { ChevronLeftIcon, MoreIcon } from './icons.tsx';
import { DatePollCreateSheet } from './date-poll-create.tsx';
import { ChatPrefsSheet } from './chat-prefs.tsx';
import { ChatBackgroundSheet } from './chat-background.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar, Confirm, GroupAvatar, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { PublicProfile } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';

type Step = 'menu' | 'clear' | 'block' | 'report' | 'poll' | 'prefs' | 'background';

/** Topo da conversa: voltar, foto e nome (preso ao rolar) e o menu ⋯ no canto oposto. */
export function ChatHead({ conversationId, other, groupName, groupImageUrl, subtitle, onCleared, below, pinned, muted, onPrefsChanged }: { conversationId: string; other: PublicProfile | null; groupName: string | null; groupImageUrl: string | null; subtitle?: string; onCleared: () => void; below?: ReactNode; pinned: boolean; muted: boolean; onPrefsChanged: () => void }) {
  const isGroup = !other;
  const name = other ? other.displayName : (groupName ?? 'Grupo');
  const to = isGroup ? `/conversas/${conversationId}/grupo` : `/conversas/${conversationId}/info`;
  const [open, setOpen] = useState(false);
  return (
    <header className="chathead">
      <Link to="/conversas" className="pagehead__back" aria-label="Voltar">
        <ChevronLeftIcon />
      </Link>
      <Link to={to} className="chathead__who" aria-label={`Informações de ${name}`}>
        {other ? <Avatar profile={other} size={40} /> : <GroupAvatar name={name} size={40} imageUrl={groupImageUrl} />}
        <span className="chathead__text">
          <span className="chathead__name">{name}</span>
          {subtitle ? <span className="chathead__sub">{subtitle}</span> : null}
        </span>
      </Link>
      <button type="button" className="iconbtn chathead__more" onClick={() => setOpen(true)} aria-label="Mais opções da conversa" aria-haspopup="dialog">
        <MoreIcon />
      </button>
      {below ? <div className="chathead__below">{below}</div> : null}
      {open ? <ChatMenu conversationId={conversationId} title={name} other={other} pinned={pinned} muted={muted} onPrefsChanged={onPrefsChanged} onClose={() => setOpen(false)} onCleared={onCleared} /> : null}
    </header>
  );
}

function ChatMenu({ conversationId, title, other, pinned, muted, onPrefsChanged, onClose, onCleared }: { conversationId: string; title: string; other: PublicProfile | null; pinned: boolean; muted: boolean; onPrefsChanged: () => void; onClose: () => void; onCleared: () => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function run(work: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setProblem(undefined);
    try {
      await work();
      after();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  if (step === 'poll') return <DatePollCreateSheet conversationId={conversationId} onClose={onClose} />;
  if (step === 'background') return <ChatBackgroundSheet conversationId={conversationId} onClose={onClose} />;
  if (step === 'prefs') return <ChatPrefsSheet conversationId={conversationId} title={title} pinned={pinned} muted={muted} onClose={onClose} onChanged={onPrefsChanged} />;

  if (step === 'report') {
    return (
      <ReasonSheet
        title={other ? `Denunciar @${other.username}` : 'Denunciar grupo'}
        extra="Enviamos as últimas mensagens de texto desta conversa para a equipe analisar."
        doneText="Obrigado por avisar. A equipe vai analisar. Se quiser, bloqueie a pessoa também."
        submit={(reason, details) => api.reportConversation(conversationId, reason, details)}
        onClose={onClose}
        onDone={onClose}
      />
    );
  }

  const row = (label: string, onClick: () => void, danger?: boolean) => (
    <li>
      <button type="button" className={`sharelist__item${danger ? ' sharelist__item--danger' : ''}`} onClick={onClick}>
        <strong>{label}</strong>
      </button>
    </li>
  );

  return (
    <Sheet title="Conversa" onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {step === 'clear' ? (
        <Confirm
          question="Limpar esta conversa? As mensagens somem só para você; a outra parte continua vendo."
          confirmLabel="Limpar conversa"
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void run(() => api.clearConversation(conversationId), () => { onClose(); onCleared(); })}
        />
      ) : step === 'block' && other ? (
        <Confirm
          danger
          question={`Bloquear @${other.username}? Essa pessoa deixa de ver seu perfil, vocês param de se seguir e a conversa some.`}
          confirmLabel="Bloquear"
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void run(() => api.block(other.userId), () => navigate('/conversas'))}
        />
      ) : (
        <ul className="sharelist">
          {row('Encontrar a melhor data', () => setStep('poll'))}
          {row(pinned || muted ? 'Fixar e silenciar (ativo)' : 'Fixar e silenciar', () => setStep('prefs'))}
          {row('Imagem de fundo', () => setStep('background'))}
          {row('Limpar conversa', () => setStep('clear'))}
          {other ? row('Bloquear', () => setStep('block'), true) : null}
          {row('Denunciar', () => setStep('report'), true)}
        </ul>
      )}
    </Sheet>
  );
}
