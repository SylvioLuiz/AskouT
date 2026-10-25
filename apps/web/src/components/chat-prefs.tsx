import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { BellOffIcon, PinIcon } from './icons.tsx';
import { Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';

/** Fixar no topo da lista e silenciar os avisos de uma conversa. Vale só para você. */
export function ChatPrefsSheet({ conversationId, title, pinned, muted, onClose, onChanged }: { conversationId: string; title: string; pinned: boolean; muted: boolean; onClose: () => void; onChanged: (prefs: { pinned: boolean; muted: boolean }) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function change(patch: { pinned?: boolean; muted?: boolean }) {
    setBusy(true);
    setProblem(undefined);
    try {
      const next = await api.setChatPrefs(conversationId, patch);
      onChanged(next);
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <ul className="sharelist">
        <li>
          <button type="button" className="sharelist__item sharelist__item--icon" disabled={busy} onClick={() => void change({ pinned: !pinned })}>
            <PinIcon />
            <strong>{pinned ? t('Desafixar conversa') : t('Fixar no topo')}</strong>
          </button>
        </li>
        <li>
          <button type="button" className="sharelist__item sharelist__item--icon" disabled={busy} onClick={() => void change({ muted: !muted })}>
            <BellOffIcon />
            <strong>{muted ? t('Reativar avisos') : t('Silenciar avisos')}</strong>
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
