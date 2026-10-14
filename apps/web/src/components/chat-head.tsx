import { Avatar, GroupAvatar } from './ui.tsx';
import { ChevronLeftIcon } from './icons.tsx';
import type { PublicProfile } from '../lib/types.ts';
import { Link } from '../router.tsx';

/** Topo da conversa: voltar, foto e nome. Fica preso no topo ao rolar; tocar na foto ou no nome abre as informações. */
export function ChatHead({ conversationId, other, groupName, groupImageUrl, subtitle }: { conversationId: string; other: PublicProfile | null; groupName: string | null; groupImageUrl: string | null; subtitle?: string }) {
  const isGroup = !other;
  const name = other ? other.displayName : (groupName ?? 'Grupo');
  const to = isGroup ? `/conversas/${conversationId}/grupo` : `/conversas/${conversationId}/info`;
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
    </header>
  );
}
