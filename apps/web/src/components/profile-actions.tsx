import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { MoreIcon } from './icons.tsx';
import { ReasonSheet, ShareLinkSheet } from './post-actions.tsx';
import { Confirm, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { profileLink, profileShareText } from '../lib/share.ts';
import type { FlashVisibility, Profile, Relationship } from '../lib/types.ts';

type Step = 'menu' | 'share' | 'remove' | 'block' | 'report';

/** Botão ⋯ do perfil de outra pessoa e a aba com as opções: compartilhar, remover seguidor, Flash e bloquear. */
export function ProfileActions({ profile, relationship, onChanged }: { profile: Profile; relationship: Relationship; onChanged: (notice: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="iconbtn profile__more" onClick={() => setOpen(true)} aria-label="Mais opções" aria-haspopup="dialog">
        <MoreIcon />
      </button>
      {open ? (
        <ProfileActionsSheet
          profile={profile}
          relationship={relationship}
          onClose={() => setOpen(false)}
          onChanged={(notice) => {
            setOpen(false);
            onChanged(notice);
          }}
        />
      ) : null}
    </>
  );
}

function ProfileActionsSheet({ profile, relationship, onClose, onChanged }: { profile: Profile; relationship: Relationship; onClose: () => void; onChanged: (notice: string) => void }) {
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const blocked = relationship.blockedByViewer;
  const flashOptions = relationship.isFriend && !blocked;
  const visibility = useAsync(() => (flashOptions ? api.flashVisibility(profile.userId) : Promise.resolve(null)), [profile.userId, flashOptions]);
  const [override, setOverride] = useState<FlashVisibility | undefined>();
  const current = override ?? visibility.data ?? undefined;

  async function toggle(key: keyof FlashVisibility) {
    if (!current) return;
    setBusy(true);
    setProblem(undefined);
    try {
      setOverride(await api.setFlashVisibility(profile.userId, { [key]: !current[key] }));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(work: () => Promise<unknown>, notice: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      await work();
      onChanged(notice);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  if (step === 'report') {
    return (
      <ReasonSheet
        title={`Denunciar @${profile.username}`}
        doneText="Obrigado por avisar. A equipe vai analisar o perfil. Se quiser, você também pode bloquear a pessoa."
        submit={(reason, details) => api.reportProfile(profile.username, reason, details)}
        onClose={() => setStep('menu')}
        onDone={onClose}
      />
    );
  }

  if (step === 'share') {
    return <ShareLinkSheet url={profileLink(window.location.origin, profile.username)} text={profileShareText(profile.username)} onClose={onClose} />;
  }

  const row = (label: string, hint: string, onClick: () => void, extra?: { danger?: boolean; on?: boolean; role?: 'switch'; disabled?: boolean }) => (
    <li>
      <button
        type="button"
        className={`sharelist__item${extra?.danger ? ' sharelist__item--danger' : ''}${extra?.on ? ' sharelist__item--on' : ''}`}
        onClick={onClick}
        disabled={busy || extra?.disabled}
        role={extra?.role}
        aria-checked={extra?.role === 'switch' ? extra.on === true : undefined}
      >
        <strong>{label}</strong>
        <span>{hint}</span>
      </button>
    </li>
  );

  return (
    <Sheet title={`@${profile.username}`} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {step === 'remove' ? (
        <Confirm
          question={`Remover @${profile.username} dos seus seguidores? ${relationship.isFriend ? 'Vocês deixam de ser amigos. ' : ''}A pessoa não é avisada.`}
          confirmLabel="Remover seguidor"
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void confirm(() => api.removeFollower(profile.userId), `@${profile.username} não segue mais você.`)}
        />
      ) : step === 'block' ? (
        <Confirm
          danger
          question={`Bloquear @${profile.username}? Essa pessoa deixa de ver seu perfil e vocês param de se seguir.`}
          confirmLabel="Bloquear"
          busy={busy}
          onCancel={() => setStep('menu')}
          onConfirm={() => void confirm(() => api.block(profile.userId), `Você bloqueou @${profile.username}.`)}
        />
      ) : (
        <ul className="sharelist">
          {row('Compartilhar perfil', 'Mande em uma conversa ou para fora do app.', () => setStep('share'))}
          {relationship.followsYou === 'ACCEPTED' && !blocked ? row('Remover seguidor', 'Ela deixa de seguir você. Não avisamos.', () => setStep('remove')) : null}
          {flashOptions && current ? row('Ocultar Flash dela', current.hideTheirs ? 'Ativo: você não vê quando ela liga o Flash.' : 'Você deixa de ver quando ela liga o Flash.', () => void toggle('hideTheirs'), { on: current.hideTheirs, role: 'switch' }) : null}
          {flashOptions && current ? row('Não deixar ela me ver no Flash', current.hideMine ? 'Ativo: ela não vê você disponível.' : 'Ela não vê você disponível, mesmo com o Flash ligado.', () => void toggle('hideMine'), { on: current.hideMine, role: 'switch' }) : null}
          {!relationship.isSelf ? row('Denunciar perfil', 'Nome, foto ou descrição que não deveriam estar aqui.', () => setStep('report'), { danger: true }) : null}
          {!blocked ? row('Bloquear', 'Ela deixa de ver seu perfil e vocês param de se seguir.', () => setStep('block'), { danger: true }) : null}
        </ul>
      )}
    </Sheet>
  );
}
