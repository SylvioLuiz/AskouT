import { Sheet } from './agenda.tsx';
import { CalendarPlusIcon, ChevronRightIcon, PhotoIcon } from './icons.tsx';
import { navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Rotas de criar: postagem (sempre num evento ou local) ou evento (tela única do evento). */
export const CREATE_POST_PATH = '/criar';
export const CREATE_EVENT_PATH = '/criar?tipo=evento';

/** Folha do botão +: escolher entre criar uma postagem ou um evento. */
export function CreateChooser({ onClose }: { onClose: () => void }) {
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const options = [
    { to: CREATE_POST_PATH, icon: <PhotoIcon />, title: t('Postagem'), text: t('Fotos ou vídeo de um evento ou de um local onde você foi.') },
    { to: CREATE_EVENT_PATH, icon: <CalendarPlusIcon />, title: t('Evento'), text: t('Marque um rolê com dia e hora e chame a galera.') },
  ];
  return (
    <Sheet title={t('O que você quer criar?')} onClose={onClose}>
      <ul className="createpick">
        {options.map((o) => (
          <li key={o.to}>
            <button type="button" className="createpick__item" onClick={() => go(o.to)}>
              <span className="createpick__icon" aria-hidden="true">
                {o.icon}
              </span>
              <span className="createpick__text">
                <strong>{o.title}</strong>
                <span className="muted">{o.text}</span>
              </span>
              <span className="createpick__chev" aria-hidden="true">
                <ChevronRightIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
