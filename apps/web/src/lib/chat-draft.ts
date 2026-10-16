const key = (conversationId: string) => `askout:draft:${conversationId}`;

/** Texto que a pessoa começou a escrever numa conversa e não enviou. Fica só neste aparelho. */
export function readDraft(conversationId: string): string {
  try {
    return localStorage.getItem(key(conversationId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(conversationId: string, text: string): void {
  try {
    if (text.trim() === '') localStorage.removeItem(key(conversationId));
    else localStorage.setItem(key(conversationId), text.slice(0, 2000));
  } catch {
    // Sem armazenamento (janela privada, por exemplo): o rascunho só não é guardado.
  }
}
