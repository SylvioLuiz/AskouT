import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { ChevronLeftIcon, MoreIcon } from './icons.tsx';
import { ChatPrefsSheet } from './chat-prefs.tsx';
import { ChatBackgroundSheet } from './chat-background.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar, Confirm, GroupAvatar, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { PublicProfile } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

type Step = 'menu' | 'clear' | 'remove' | 'block' | 'report' | 'prefs' | 'background';

/** Topo da conversa: voltar, foto e nome (preso ao rolar) e o menu ⋯ no canto oposto. */
export function ChatHead({ conversationId, other, groupName, groupImageUrl, subtitle, onCleared, below, pinned, muted, onPrefsChanged }: { conversationId: string; other: PublicProfile | null; groupName: string | null; groupImageUrl: string | null; subtitle?: string; onCleared: () => void; below?: ReactNode; pinned: boolean; muted: boolean; onPrefsChanged: () => void }) {
  const isGroup = !other;
  const name = other ? other.displayName : (groupName ?? t('Grupo'));
  const to = isGroup ? `/conversas/${conversationId}/grupo` : `/conversas/${conversationId}/info`;
  const [open, setOpen] = useState(false);
  return (
    <header className="chathead">
      <Link to="/conversas" className="pagehead__back" aria-label={t('Voltar')}>
        <ChevronLeftIcon />
      </Link>
      <Link to={to} className="chathead__who" aria-label={t('Informações de {name}', { name })}>
        {other ? <Avatar profile={other} size={40} /> : <GroupAvatar name={name} size={40} imageUrl={groupImageUrl} />}
        <span className="chathead__text">
          <span className="chathead__name">{name}</span>
          {subtitle ? <span className="chathead__sub">{subtitle}</span> : null}
        </span>
      </Link>
      <button type="button" className="iconbtn chathead__more" onClick={() => setOpen(true)} aria-label={t('Mais opções da conversa')} aria-haspopup="dialog">
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

  if (step === 'background') return <ChatBackgroundSheet conversationId={conversationId} onClose={onClose} />;
  if (step === 'prefs') return <ChatPrefsSheet conversationId={conversationId} title={title} pinned={pinned} muted={muted} onClose={onClose} onChanged={onPrefsChanged} />;

  if (step === 'report') {
    return (
      <ReasonSheet
        title={other ? t('Denunciar @{username}', { username: other.username }) : t('Denunciar grupo')}
        extra={t('Enviamos as últimas mensagens de texto desta conversa para a equipe analisar.')}
        doneText={t('Obrigado por avisar. A equipe vai analisar. Se quiser, bloqueie a pessoa também.')}
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
    <Sheet title={t('Conversa')} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {step === 'clear' ? (
        <Confirm
          question={t('Limpar esta conversa? As mensagens somem só para você; a outra parte continua vendo.')}
          confirmLabel={t('Limpar conversa')}
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void run(() => api.clearConversation(conversationId), () => { onClose(); onCleared(); })}
        />
      ) : step === 'remove' ? (
        <Confirm
          danger
          question={t('Apagar esta conversa? Ela some da sua lista e as mensagens somem para você; a outra pessoa continua vendo. Se ela escrever de novo, a conversa volta só com as mensagens novas.')}
          confirmLabel={t('Apagar conversa')}
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void run(() => api.clearConversation(conversationId), () => navigate('/conversas'))}
        />
      ) : step === 'block' && other ? (
        <Confirm
          danger
          question={t('Bloquear @{username}? Essa pessoa deixa de ver seu perfil, vocês param de se seguir e a conversa some.', { username: other.username })}
          confirmLabel={t('Bloquear')}
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void run(() => api.block(other.userId), () => navigate('/conversas'))}
        />
      ) : (
        <ul className="sharelist">
          {row(t('Encontrar a melhor data'), () => {
            onClose();
            navigate(`/planejar/nova/${conversationId}`);
          })}
          {row(pinned || muted ? t('Fixar e silenciar (ativo)') : t('Fixar e silenciar'), () => setStep('prefs'))}
          {row(t('Imagem de fundo'), () => setStep('background'))}
          {row(t('Limpar conversa'), () => setStep('clear'))}
          {other ? row(t('Apagar conversa'), () => setStep('remove'), true) : null}
          {other ? row('Bloquear', () => setStep('block'), true) : null}
          {row('Denunciar', () => setStep('report'), true)}
        </ul>
      )}
    </Sheet>
  );
}
