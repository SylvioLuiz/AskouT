import { useState } from 'react';
import { api } from '../client.ts';
import { fileLabel } from '../lib/chat-file.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';
import { openDocument } from '../lib/save-file.ts';
import type { ChatMessage } from '../lib/types.ts';

/** Ícone de documento com a sigla do tipo (PDF, DOC, XLS...). */
function DocIcon({ ext }: { ext: string }) {
  return (
    <span className="filebubble__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M6 2.75h8.5L19.25 7.5v13.75H6z" />
        <path d="M14.25 2.75V7.75h5" />
      </svg>
      <span className="filebubble__ext">{ext.slice(0, 4).toUpperCase() || 'DOC'}</span>
    </span>
  );
}

/** Documento na conversa: nome e tipo; tocar baixa e abre (no app, no menu "Abrir com" do aparelho). */
export function FileBubble({ message, conversationId }: { message: ChatMessage; conversationId: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const name = message.body;
  const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';

  async function open() {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const blob = await api.messageMedia(conversationId, message.id);
      await openDocument(blob, name);
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="filebubble">
      <button
        type="button"
        className="filebubble__open"
        onClick={(e) => {
          e.stopPropagation();
          void open();
        }}
        aria-busy={busy || undefined}
        aria-label={t('Abrir {name}', { name })}
      >
        <DocIcon ext={ext} />
        <span className="filebubble__text">
          <span className="filebubble__name">{name}</span>
          <span className="filebubble__meta">{busy ? t('Abrindo…') : fileLabel(name)}</span>
        </span>
      </button>
      {problem ? <span className="filebubble__problem">{problem}</span> : null}
    </div>
  );
}
