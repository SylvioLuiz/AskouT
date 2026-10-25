import { VolumeIcon, VolumeOffIcon } from './icons.tsx';
import { t } from '../lib/i18n/index.ts';

/** Botão simples no canto direito: tira o som e, se estiver sem som, devolve. */
export function SoundToggle({ muted, onToggle, shifted = false }: { muted: boolean; onToggle: () => void; shifted?: boolean }) {
  return (
    <button type="button" className={`soundtoggle${shifted ? ' soundtoggle--shifted' : ''}`} onClick={onToggle} aria-pressed={muted} aria-label={muted ? t('Ligar o som') : t('Tirar o som')}>
      {muted ? <VolumeOffIcon /> : <VolumeIcon />}
    </button>
  );
}
