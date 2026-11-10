/** Aviso rápido no pé da tela, fora da árvore do React: continua visível mesmo que a tela que o chamou feche. */
export function showToast(text: string, ms = 800): void {
  if (typeof document === 'undefined' || text === '') return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), ms);
}
