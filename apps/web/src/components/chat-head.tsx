import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { ChevronLeftIcon, MoreIcon } from './icons.tsx';
import { ChatPrefsSheet } from './chat-prefs.tsx';
import { ChatBackgroundSheet } from './chat-background.tsx';
import { ChatColorSheet } from './chat-color.tsx';
import { ReasonSheet } from './post-actions.tsx';
import { Avatar, Confirm, GroupAvatar, Notice } from './ui.tsx';
import { useOnline } from './online-presence.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { useUser } from '../auth.tsx';
import { pinnedPoll } from '../lib/date-poll.ts';
import { toApiError } from '../lib/errors.ts';
import type { PublicProfile, VenueChat } from '../lib/types.ts';
import { safeImage } from '../lib/explore.ts';
import { Link, navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

type Step = 'menu' | 'clear' | 'remove' | 'leave' | 'block' | 'report' | 'prefs' | 'background' | 'color';

/** Topo da conversa: voltar, foto e nome (preso ao rolar) e o menu ⋯ no canto oposto. */
export function ChatHead({ conversationId, other, venue, groupName, groupImageUrl, subtitle, onCleared, below, pinned, muted, onPrefsChanged, color, onColorChange }: { conversationId: string; other: PublicProfile | null; venue?: VenueChat | null; groupName: string | null; groupImageUrl: string | null; subtitle?: string; onCleared: () => void; below?: ReactNode; pinned: boolean; muted: boolean; onPrefsChanged: () => void; color: string | null; onColorChange: (color: string | null) => void }) {
  const isGroup = !other;
  // Conversa pela página de um local: quem escreveu vê o local (foto, nome e link para a página).
  const asVenue = venue?.role === 'CUSTOMER' ? venue : null;
  const name = asVenue ? asVenue.name : other ? other.displayName : (groupName ?? t('Grupo'));
  const to = asVenue ? `/bares/${encodeURIComponent(asVenue.id)}` : isGroup ? `/conversas/${conversationId}/grupo` : `/conversas/${conversationId}/info`;
  const [open, setOpen] = useState(false);
  // Conversa 1 a 1 com a pessoa online: "Online" em verde junto do @.
  const online = useOnline(asVenue ? undefined : (other?.userId ?? undefined));
  return (
    <header className="chathead">
      <Link to="/conversas" className="pagehead__back" aria-label={t('Voltar')}>
        <ChevronLeftIcon />
      </Link>
      <Link to={to} className="chathead__who" aria-label={t('Informações de {name}', { name })}>
        {asVenue ? <GroupAvatar name={name} size={40} imageUrl={safeImage(asVenue.logoUrl)} /> : other ? <Avatar profile={other} size={40} /> : <GroupAvatar name={name} size={40} imageUrl={groupImageUrl} />}
        <span className="chathead__text">
          <span className="chathead__name">{name}</span>
          {online ? (
            <span className="chathead__sub">
              <span className="chathead__online">{t('Online')}</span>
              {subtitle ? ` · ${subtitle}` : null}
            </span>
          ) : subtitle ? (
            <span className="chathead__sub">{subtitle}</span>
          ) : null}
        </span>
      </Link>
      <button type="button" className="iconbtn chathead__more" onClick={() => setOpen(true)} aria-label={t('Mais opções da conversa')} aria-haspopup="dialog">
        <MoreIcon />
      </button>
      {below ? <div className="chathead__below">{below}</div> : null}
      {open ? <ChatMenu conversationId={conversationId} title={name} other={other} pinned={pinned} muted={muted} onPrefsChanged={onPrefsChanged} color={color} onColorChange={onColorChange} onClose={() => setOpen(false)} onCleared={onCleared} /> : null}
    </header>
  );
}

function ChatMenu({ conversationId, title, other, pinned, muted, onPrefsChanged, color, onColorChange, onClose, onCleared }: { conversationId: string; title: string; other: PublicProfile | null; pinned: boolean; muted: boolean; onPrefsChanged: () => void; color: string | null; onColorChange: (color: string | null) => void; onClose: () => void; onCleared: () => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const isGroup = !other;
  const me = useUser();
  // Votação de data ainda aberta nesta conversa: não faz sentido abrir outra, o menu leva até ela.
  const polls = useAsync(() => api.conversationPolls(conversationId), [conversationId]);
  const now = new Date();
  const openPoll = (polls.data?.items ?? []).map((p) => ({ id: p.id, line: pinnedPoll(p, now) })).find((p) => p.line !== null);
  // Grupo: o evento dele (grupo de um evento) e quem criou, para "Ver o evento" e "Sair do grupo".
  const group = useAsync(() => (isGroup ? api.group(conversationId) : Promise.resolve(null)), [conversationId, isGroup]);
  const groupEvent = group.data?.event ?? null;

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
  if (step === 'color') return <ChatColorSheet conversationId={conversationId} current={color} onClose={onClose} onChange={onColorChange} />;
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

  const row = (label: string, onClick: () => void, danger?: boolean, hint?: string, disabled?: boolean) => (
    <li>
      <button type="button" className={`sharelist__item${danger ? ' sharelist__item--danger' : ''}`} onClick={onClick} disabled={disabled} aria-busy={disabled || undefined}>
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
      </button>
    </li>
  );
  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };

  return (
    <Sheet title={t('Conversa')} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {step === 'clear' ? (
        <Confirm
          question={isGroup ? t('Limpar esta conversa? As mensagens somem só para você; as outras pessoas do grupo continuam vendo.') : t('Limpar esta conversa? As mensagens somem só para você; a outra parte continua vendo.')}
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
      ) : step === 'leave' && isGroup ? (
        <Confirm
          danger
          question={`${t('Você deixa de ver as mensagens do grupo e sai dos encontros dele.')}${group.data && group.data.ownerId === me.id && group.data.members.length > 1 ? t(' Outra pessoa passa a administrar o grupo.') : ''} ${t('Para voltar, só com um novo convite.')}`}
          confirmLabel={t('Sair do grupo')}
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void run(() => api.leaveGroup(conversationId), () => navigate('/conversas'))}
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
          {/* O que o grupo está combinando: a votação aberta (ou criar uma, se não houver), o evento e as pessoas. */}
          {openPoll?.line
            ? row(t('Ver a votação'), go(`/planejar/${openPoll.id}`), false, `${openPoll.line.name} · ${openPoll.line.status}`)
            : row(t('Combinar uma data'), go(`/planejar/nova/${conversationId}`), false, undefined, polls.loading && !polls.data)}
          {groupEvent ? row(t('Ver o evento'), go(`/eventos/${encodeURIComponent(groupEvent.id)}`), false, groupEvent.title) : null}
          {isGroup ? row(t('Pessoas e dados do grupo'), go(`/conversas/${conversationId}/grupo`)) : null}
          {/* Do jeito de cada um: só muda para você. */}
          {row(t('Fixar e silenciar'), () => setStep('prefs'), false, prefsHint(pinned, muted))}
          {row(t('Cor da conversa'), () => setStep('color'))}
          {row(t('Imagem de fundo'), () => setStep('background'))}
          {row(t('Limpar conversa'), () => setStep('clear'))}
          {/* Saídas e segurança, por último. */}
          {other ? row(t('Apagar conversa'), () => setStep('remove'), true) : null}
          {isGroup ? row(t('Sair do grupo'), () => setStep('leave'), true) : null}
          {other ? row(t('Bloquear'), () => setStep('block'), true) : null}
          {row(isGroup ? t('Denunciar grupo') : t('Denunciar'), () => setStep('report'), true)}
        </ul>
      )}
    </Sheet>
  );
}

/** Estado de fixar e silenciar, como dica abaixo do item do menu. Nada ativo: sem dica. */
function prefsHint(pinned: boolean, muted: boolean): string | undefined {
  if (pinned && muted) return t('Fixada e silenciada');
  if (pinned) return t('Fixada');
  if (muted) return t('Silenciada');
  return undefined;
}
