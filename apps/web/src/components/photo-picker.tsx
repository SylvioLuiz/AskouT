import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from './agenda.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Folha com as opções da foto de perfil: ver em tela cheia, tirar com a câmera, escolher da galeria ou remover.
 * Só entrega o arquivo escolhido (ou o pedido de remoção); quem chama decide se salva na hora ou depois.
 */
export function PhotoPickerSheet({ hasPhoto, onPick, onRemove, onView, onClose }: { hasPhoto: boolean; onPick: (file: File) => void; onRemove?: () => void; onView?: () => void; onClose: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    onClose();
    onPick(file);
  }

  return (
    <Sheet title={t('Foto de perfil')} onClose={onClose}>
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="visually-hidden" aria-label={t('Tirar foto')} tabIndex={-1} onChange={picked} />
      <input ref={galleryRef} type="file" accept="image/*" className="visually-hidden" aria-label={t('Escolher foto de perfil')} tabIndex={-1} onChange={picked} />
      {hasPhoto && onView ? (
        <ul className="menulist">
          <li>
            <button
              type="button"
              className="menulist__item"
              onClick={() => {
                onClose();
                onView();
              }}
            >
              <span>{t('Ver foto')}</span>
            </button>
          </li>
        </ul>
      ) : null}
      <ul className="menulist">
        <li>
          <button type="button" className="menulist__item" onClick={() => cameraRef.current?.click()}>
            <span>{t('Tirar foto')}</span>
          </button>
        </li>
        <li>
          <button type="button" className="menulist__item" onClick={() => galleryRef.current?.click()}>
            <span>{t('Escolher da galeria')}</span>
          </button>
        </li>
      </ul>
      {hasPhoto && onRemove ? (
        <ul className="menulist">
          <li>
            <button
              type="button"
              className="menulist__item menulist__item--danger"
              onClick={() => {
                onClose();
                onRemove();
              }}
            >
              <span>{t('Remover foto')}</span>
            </button>
          </li>
        </ul>
      ) : null}
    </Sheet>
  );
}
