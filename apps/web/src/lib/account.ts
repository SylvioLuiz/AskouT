// Baixar os próprios dados e apagar a conta (LGPD).

/** O @usuário digitado confere com o da conta? Ignora espaços, "@" na frente e maiúsculas. */
export function usernameMatches(typed: string, username: string): boolean {
  const t = typed.trim().replace(/^@/, '').toLowerCase();
  return t !== '' && t === username.toLowerCase();
}

/** Nome de arquivo seguro: só letras, números, ponto, hífen e sublinhado. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 100);
  return cleaned.endsWith('.json') ? cleaned : `${cleaned || 'askout-meus-dados'}.json`;
}

/** Entrega o JSON como arquivo para o aparelho guardar. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
