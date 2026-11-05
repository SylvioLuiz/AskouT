/**
 * Telefone no formato internacional (E.164, ex.: +5511987654321). A mesma regra roda no app (apps/web/src/lib/phone.ts),
 * para que o código do número na agenda de alguém bata com o número que a pessoa cadastrou no perfil.
 * Sem código do país, entende como Brasil (+55).
 */
export function normalizePhone(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return valid(digits);
  if (digits.startsWith('00')) return valid(digits.slice(2));
  // Interurbano com operadora (0 + 2 dígitos da operadora + DDD + número) e só com o 0 na frente.
  if (digits.startsWith('0') && (digits.length === 13 || digits.length === 14)) digits = digits.slice(3);
  else if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) return valid(`55${digits}`);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return valid(digits);
  return undefined;
}

function valid(digits: string): string | undefined {
  if (!/^[1-9]\d{7,14}$/.test(digits)) return undefined;
  // Brasil: DDD (2 dígitos, sem 0) e número de 8 ou 9 dígitos.
  if (digits.startsWith('55') && !/^55[1-9][1-9]\d{8,9}$/.test(digits)) return undefined;
  return `+${digits}`;
}
