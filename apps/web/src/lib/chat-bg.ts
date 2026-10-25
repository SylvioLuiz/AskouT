import { useEffect, useState } from 'react';
import { resizePhoto, safeGroupImage } from './image.ts';
import { t } from '../lib/i18n/index.ts';

const EVENT = 'askout:chatbg';
const key = (conversationId: string) => `askout:chatbg:${conversationId}`;

/** Imagem de fundo escolhida para uma conversa. Fica só neste aparelho (não vai para o servidor). */
export function getChatBackground(conversationId: string): string | null {
  try {
    return safeGroupImage(localStorage.getItem(key(conversationId)));
  } catch {
    return null;
  }
}

export function setChatBackground(conversationId: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key(conversationId), value);
    else localStorage.removeItem(key(conversationId));
  } catch {
    throw new Error(t('O navegador não deixou guardar a imagem de fundo'));
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Reduz a imagem escolhida (até 960 px e 180 KB) para caber no armazenamento do aparelho. */
export const resizeChatBackground = (file: File) => resizePhoto(file, { side: 960, maxBytes: 180 * 1024 });

export function useChatBackground(conversationId: string): string | null {
  const [value, setValue] = useState(() => getChatBackground(conversationId));
  useEffect(() => {
    setValue(getChatBackground(conversationId));
    const sync = () => setValue(getChatBackground(conversationId));
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [conversationId]);
  return value;
}
