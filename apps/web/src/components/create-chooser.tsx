import { useEffect, useRef } from 'react';
import { Sheet } from './agenda.tsx';
import { CalendarPlusIcon, ChevronRightIcon, PhotoIcon } from './icons.tsx';
import { navigate, rememberScroll } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Rotas de criar: postagem (sempre num evento ou local) ou evento (tela única do evento). */
export const CREATE_POST_PATH = '/criar';
export const CREATE_EVENT_PATH = '/criar?tipo=evento';

/** Folha do botão +: escolher entre criar uma postagem ou um evento. */
export function CreateChooser({ onClose }: { onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A folha ganha uma entrada no histórico: o "voltar" (do celular ou do navegador) fecha a folha em vez de sair da tela.
  useEffect(() => {
    const onEntry = () => (window.history.state as { createChooser?: boolean } | null)?.createChooser === true;
    rememberScroll();
    if (!onEntry()) {
      const state = (window.history.state as Record<string, unknown> | null) ?? {};
      const idx = typeof state.askoutIdx === 'number' ? state.askoutIdx : 0;
      window.history.pushState({ askoutIdx: idx + 1, createChooser: true }, '');
    }
    let closedByBack = false;
    const onPop = () => {
      if (onEntry()) return;
      closedByBack = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (closedByBack) return;
      // Fechou pelo X, arrastando ou tocando fora: tira a entrada da folha do histórico.
      window.setTimeout(() => {
        if (onEntry()) window.history.back();
      }, 0);
    };
  }, []);

  const go = (to: string) => {
    // Troca a entrada da folha pela tela escolhida: voltar dela leva direto para onde o + foi tocado.
    navigate(to, { replace: true });
    onClose();
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
