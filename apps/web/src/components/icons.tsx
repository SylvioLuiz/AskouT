import type { ReactNode } from 'react';
import type { EventKind } from '../lib/types.ts';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Svg>
    <path d="M4 11l8-7 8 7v8.5a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19.5z" />
  </Svg>
);
export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
);
export const ChatIcon = () => (
  <Svg>
    <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z" />
  </Svg>
);
export const CalendarIcon = () => (
  <Svg>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Svg>
);
export const BellIcon = () => (
  <Svg>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14zM10 20.5a2 2 0 0 0 4 0" />
  </Svg>
);
export const UserIcon = () => (
  <Svg>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Svg>
);
export const LockIcon = () => (
  <Svg>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);
export const ChevronLeftIcon = () => (
  <Svg>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const AlertIcon = () => (
  <Svg>
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4M12 16.8v.2" />
  </Svg>
);
export const HalfIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5v15a7.5 7.5 0 0 0 0-15z" fill="currentColor" />
  </Svg>
);
export const XIcon = () => (
  <Svg>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);
export const ClockIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const BoltIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg className="icon" viewBox="0 0 24 24" width="24" height="24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6z" />
  </svg>
);

export const MenuIcon = () => (
  <Svg>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const EditIcon = () => (
  <Svg>
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);
export const ShareIcon = () => (
  <Svg>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12" />
  </Svg>
);

export const HeartIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg className="icon" viewBox="0 0 24 24" width="24" height="24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z" />
  </svg>
);

export const CommentIcon = () => (
  <Svg>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5Z" />
  </Svg>
);

export const SendIcon = () => (
  <Svg>
    <path d="M21 4 10.5 14.5" />
    <path d="M21 4l-6.5 17-4-6.5L4 10.5Z" />
  </Svg>
);

export const MoreIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="5.5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="18.5" cy="12" r="1.9" />
  </svg>
);

export const CropIcon = () => (
  <Svg>
    <path d="M8 6.5 2.5 12 8 17.5" />
    <path d="M16 6.5 21.5 12 16 17.5" />
  </Svg>
);

export const CarouselIcon = () => (
  <Svg>
    <rect x="8" y="3.5" width="12.5" height="12.5" rx="2" />
    <path d="M4 8v10.5A2 2 0 0 0 6 20.5h10.5" />
  </Svg>
);

export const PlusBigIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const InfoIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.6h.01" />
  </svg>
);

export const ArrowUpIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </svg>
);

export const MicIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3" />
  </svg>
);

export const PlayIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
);

export const PauseIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="6" y="5" width="4.2" height="14" rx="1.2" />
    <rect x="13.8" y="5" width="4.2" height="14" rx="1.2" />
  </svg>
);

export const TrashIcon = () => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </svg>
);

/** Ícone do tipo de evento (o círculo no meio da capa). */
export function EventKindIcon({ kind }: { kind: EventKind }) {
  switch (kind) {
    case 'OUTDOOR':
      // Árvore.
      return (
        <Svg>
          <path d="M12 3 7 10h3l-4 6h12l-4-6h3z" />
          <path d="M12 16v5" />
        </Svg>
      );
    case 'SPORT':
      // Troféu.
      return (
        <Svg>
          <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
          <path d="M8 6H5a3 3 0 0 0 3 4" />
          <path d="M16 6h3a3 3 0 0 1-3 4" />
          <path d="M12 13v4" />
          <path d="M8 21h8M9 17h6v4H9z" />
        </Svg>
      );
    case 'SHOW':
      return (
        <Svg>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </Svg>
      );
    case 'CINEMA':
      return (
        <Svg>
          <rect x="3" y="8" width="18" height="12" rx="2" />
          <path d="m3 8 3-5h4L7 8" />
          <path d="m10 8 3-5h4l-3 5" />
        </Svg>
      );
    case 'THEATER':
      return (
        <Svg>
          <path d="M4 5h10v6a5 5 0 0 1-10 0z" />
          <path d="M7.5 8.5h.01M10.5 8.5h.01" />
          <path d="M7 12q2 1.6 4 0" />
          <path d="M16 9h4v5a4 4 0 0 1-6.5 3" />
        </Svg>
      );
    case 'EXHIBITION':
      return (
        <Svg>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m21 16-5-5-8 9" />
        </Svg>
      );
    case 'GASTRONOMY':
      return (
        <Svg>
          <path d="M5 3v5a2 2 0 0 0 4 0V3" />
          <path d="M7 3v18" />
          <path d="M17 3c-2 2-3 5-3 8h3" />
          <path d="M17 3v18" />
        </Svg>
      );
    case 'NIGHT':
      return (
        <Svg>
          <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
        </Svg>
      );
    case 'DIGITAL':
      return (
        <Svg>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
        </Svg>
      );
    default:
      return (
        <Svg>
          <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6-4.5-4.2 6.1-.7z" />
        </Svg>
      );
  }
}

export const MapIcon = () => (
  <Svg>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);

export const ChevronDownIcon = () => (
  <Svg>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
);
export const StarIcon = () => (
  <Svg>
    <path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.8Z" />
  </Svg>
);
export const LocationIcon = () => (
  <Svg>
    <path d="M12 21s6.5-6.1 6.5-11A6.5 6.5 0 0 0 5.5 10c0 4.9 6.5 11 6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

const Line = ({ children }: { children: ReactNode }) => (
  <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const ReplyIcon = () => (
  <Line>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h10a6 6 0 0 1 6 6v1" />
  </Line>
);

export const PinIcon = () => (
  <Line>
    <path d="M9 4h6l-1 6 3 3H7l3-3z" />
    <path d="M12 13v7" />
  </Line>
);

export const BellOffIcon = () => (
  <Line>
    <path d="M6 9a6 6 0 0 1 9.5-4.9M18 9c0 4 1.5 5.5 2 6.5H8" />
    <path d="M4 15.5c.8-.8 1.7-2 1.9-4.2" />
    <path d="M10 19a2 2 0 0 0 4 0" />
    <path d="M3 3l18 18" />
  </Line>
);

export const PhotoIcon = () => (
  <Line>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-9 8" />
  </Line>
);

export const CopyIcon = () => (
  <Line>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </Line>
);
