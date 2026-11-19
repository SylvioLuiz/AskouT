import { createPortal } from 'react-dom';
import { Sheet } from './agenda.tsx';
import { Button } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

/** Ao tocar em "Eu vou": mostrar o evento na aba Eventos do perfil ou deixar só na aba Participou, que só a pessoa vê. */
export function GoingChoiceSheet({ onChoose, onClose, busy }: { onChoose: (onProfile: boolean) => void; onClose: () => void; busy?: boolean }) {
  // Fora do cartão (o cartaz isola a pilha de camadas e pinta o texto de branco).
  return createPortal(
    <Sheet title={t('Mostrar no seu perfil?')} onClose={onClose}>
      <p className="muted">{t('Na aba Eventos, quem visita seu perfil vê que você vai. Se preferir, o evento fica só na aba Participou, que só você vê.')}</p>
      <div className="sheetactions">
        <Button full loading={busy} onClick={() => onChoose(true)}>
          {t('Mostrar na aba Eventos')}
        </Button>
        <Button full variant="secondary" disabled={busy} onClick={() => onChoose(false)}>
          {t('Só para mim')}
        </Button>
      </div>
    </Sheet>,
    document.body,
  );
}
