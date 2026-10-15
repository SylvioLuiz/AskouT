import type { KeyboardEvent, MouseEvent } from 'react';
import { Link, navigate } from '../router.tsx';

/**
 * Nome do bar que leva à página dele. Dentro de outro link (cartão de evento, por exemplo) não pode haver
 * um <a> dentro de outro <a>: com `nested`, vira um elemento com papel de link que só abre a página do bar.
 */
export function VenueLink({ venueId, name, nested = false, className }: { venueId: string | null | undefined; name: string; nested?: boolean; className?: string }) {
  if (!venueId) return <span className={className}>{name}</span>;
  const to = `/bares/${encodeURIComponent(venueId)}`;
  const cls = `venuelink${className ? ` ${className}` : ''}`;
  if (!nested) {
    return (
      <Link to={to} className={cls}>
        {name}
      </Link>
    );
  }
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(to);
  };
  return (
    <span role="link" tabIndex={0} className={cls} onClick={open} onKeyDown={(event) => (event.key === 'Enter' ? open(event) : undefined)}>
      {name}
    </span>
  );
}
