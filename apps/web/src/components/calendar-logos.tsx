import type { CalendarLogoKind } from '../lib/calendar-sync.ts';

/**
 * Ícones dos apps de agenda (desenho simplificado, nas cores de cada marca), como nas telas de "conectar agenda"
 * dos apps de mercado. Decorativos: o nome do app sempre aparece em texto ao lado.
 */
export function CalendarLogo({ kind, size = 40 }: { kind: CalendarLogoKind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 48 48', 'aria-hidden': true as const, className: 'callogo' };
  switch (kind) {
    case 'GOOGLE':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="40" height="40" rx="9" fill="#fff" />
          <path d="M13 8h22a5 5 0 0 1 5 5v22H8V13a5 5 0 0 1 5-5z" fill="#fff" stroke="#dadce0" />
          <path d="M40 35v-22a5 5 0 0 0-5-5h-3v27z" fill="#4285F4" />
          <path d="M8 35h24v5H13a5 5 0 0 1-5-5z" fill="#34A853" />
          <path d="M32 35h8l-8 5z" fill="#EA4335" />
          <path d="M8 13a5 5 0 0 1 5-5v27H8z" fill="#FBBC04" />
          <text x="20.5" y="28.5" textAnchor="middle" fontFamily="Roboto, Arial, sans-serif" fontWeight="700" fontSize="13" fill="#4285F4">31</text>
        </svg>
      );
    case 'OUTLOOK':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="40" height="40" rx="9" fill="#0078D4" />
          <rect x="22" y="13" width="16" height="22" rx="2" fill="#50A8F2" />
          <path d="M22 22l8 5 8-5v11a2 2 0 0 1-2 2H22z" fill="#28A8EA" />
          <rect x="9" y="12" width="20" height="24" rx="3" fill="#0A5CAB" />
          <ellipse cx="19" cy="24" rx="5.5" ry="6.5" fill="none" stroke="#fff" strokeWidth="2.6" />
        </svg>
      );
    case 'ICLOUD':
      return (
        <svg {...common}>
          <defs>
            <linearGradient id="icloud-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3EB4F7" />
              <stop offset="1" stopColor="#1E7CE6" />
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="40" height="40" rx="9" fill="#fff" stroke="#e5e5ea" />
          <path d="M15.5 32a6 6 0 0 1-.6-12 8.5 8.5 0 0 1 16.3-2.2A6.8 6.8 0 0 1 33 31.9z" fill="url(#icloud-g)" />
        </svg>
      );
    case 'DEVICE': {
      // Como o ícone do app de agenda do celular: dia da semana em vermelho e o dia de hoje.
      const now = new Date();
      const weekday = now.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '').toUpperCase().slice(0, 3);
      return (
        <svg {...common}>
          <rect x="4" y="4" width="40" height="40" rx="9" fill="#fff" stroke="#e5e5ea" />
          <text x="24" y="17" textAnchor="middle" fontFamily="-apple-system, system-ui, sans-serif" fontWeight="600" fontSize="8" fill="#FF3B30">{weekday}</text>
          <text x="24" y="36" textAnchor="middle" fontFamily="-apple-system, system-ui, sans-serif" fontWeight="400" fontSize="19" fill="#1d1d1f">{now.getDate()}</text>
        </svg>
      );
    }
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="40" height="40" rx="9" fill="#fff" stroke="#e5e5ea" />
          <rect x="13" y="14" width="22" height="20" rx="3" fill="none" stroke="#8e8e93" strokeWidth="2.4" />
          <path d="M13 20h22M19 11v6M29 11v6" stroke="#8e8e93" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
  }
}
