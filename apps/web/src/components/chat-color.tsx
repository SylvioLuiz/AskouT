import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Sheet } from './agenda.tsx';
import { Notice } from './ui.tsx';
import { api } from '../client.ts';
import { CHAT_COLORS, chatColorLabel } from '../lib/chat-color.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';

/** Escolher a cor da conversa. Muda na hora (para você ver como fica) e fica salva na sua conta; a outra pessoa não vê. */
export function ChatColorSheet({ conversationId, current, onClose, onChange }: { conversationId: string; current: string | null; onClose: () => void; onChange: (color: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function pick(color: string | null) {
    if (color === current) return onClose();
    const before = current;
    onChange(color);
    setBusy(true);
    setProblem(undefined);
    try {
      await api.setChatPrefs(conversationId, { color });
      onClose();
    } catch (failure) {
      onChange(before);
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  const options: { id: string | null; label: string; dot: string }[] = [
    { id: null, label: t('Padrão'), dot: 'linear-gradient(135deg, #b56efc, #fa72c9)' },
    ...CHAT_COLORS.map((c) => ({ id: c.id, label: chatColorLabel(c), dot: c.fill })),
  ];

  return (
    <Sheet title={t('Cor da conversa')} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <p className="muted">{t('Muda a cor dos seus balões e dos botões nesta conversa. Só você vê.')}</p>
      <ul className="colorpick">
        {options.map((o) => (
          <li key={o.id ?? 'default'}>
            <button type="button" className="colorpick__item" aria-pressed={o.id === current} disabled={busy} onClick={() => void pick(o.id)}>
              <span className="colorpick__dot" style={{ '--dot': o.dot } as CSSProperties} aria-hidden="true" />
              {o.label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
