import { VolumeIcon, VolumeOffIcon } from './icons.tsx';

/** Botão simples no canto direito: tira o som e, se estiver sem som, devolve. */
export function SoundToggle({ muted, onToggle, shifted = false }: { muted: boolean; onToggle: () => void; shifted?: boolean }) {
  return (
    <button type="button" className={`soundtoggle${shifted ? ' soundtoggle--shifted' : ''}`} onClick={onToggle} aria-pressed={muted} aria-label={muted ? 'Ligar o som' : 'Tirar o som'}>
      {muted ? <VolumeOffIcon /> : <VolumeIcon />}
    </button>
  );
}
