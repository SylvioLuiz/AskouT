export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  codeSecret: string;
  tokenTtlSeconds: number;
  corsOrigins: string[];
  /** Hoje só existe o envio "console" (imprime o código no terminal, só para desenvolvimento). */
  emailTransport: 'console';
  /** Contato (e-mail ou site) enviado no User-Agent ao consultar o OpenStreetMap. Opcional em desenvolvimento. */
  osmContact: string | undefined;
  /** Chave do Google Places. Sem ela, a fonte Google fica desligada e o app usa só OpenStreetMap. */
  googlePlacesKey: string | undefined;
  /** Teto de buscas ao Google por dia, para não estourar o crédito gratuito sem perceber. */
  googleDailyLimit: number;
}

const MIN_SECRET = 32;

/** Valida o ambiente de uma vez e lista TODOS os problemas, para o erro de subida ser útil. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const problems: string[] = [];

  const rawEnv = env.NODE_ENV ?? 'development';
  if (rawEnv !== 'development' && rawEnv !== 'test' && rawEnv !== 'production') {
    problems.push('NODE_ENV deve ser development, test ou production');
  }
  const nodeEnv = rawEnv === 'production' || rawEnv === 'test' ? rawEnv : 'development';

  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT deve ser um inteiro entre 1 e 65535');

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) problems.push('DATABASE_URL deve começar com postgresql://');

  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < MIN_SECRET) problems.push(`JWT_SECRET precisa ter ao menos ${MIN_SECRET} caracteres`);

  const codeSecret = env.CODE_SECRET ?? '';
  if (codeSecret.length < MIN_SECRET) problems.push(`CODE_SECRET precisa ter ao menos ${MIN_SECRET} caracteres`);
  if (jwtSecret.length >= MIN_SECRET && jwtSecret === codeSecret) {
    problems.push('JWT_SECRET e CODE_SECRET devem ser diferentes');
  }

  const tokenTtlSeconds = Number(env.TOKEN_TTL_SECONDS ?? '3600');
  if (!Number.isInteger(tokenTtlSeconds) || tokenTtlSeconds < 60 || tokenTtlSeconds > 86_400 * 30) {
    problems.push('TOKEN_TTL_SECONDS deve ficar entre 60 e 2592000');
  }

  const emailTransport = env.EMAIL_TRANSPORT ?? 'console';
  if (emailTransport !== 'console') {
    problems.push('EMAIL_TRANSPORT: só "console" está implementado (ainda não há provedor real de e-mail)');
  } else if (nodeEnv === 'production') {
    problems.push('Em produção o envio "console" é recusado: ele imprime os códigos de cadastro no log. Falta implementar um provedor real de e-mail');
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (corsOrigins.some((o) => o === '*')) problems.push('CORS_ORIGINS não aceita "*"; liste as origens');

  const googleDailyLimit = Number(env.GOOGLE_DAILY_LIMIT ?? '500');
  if (!Number.isInteger(googleDailyLimit) || googleDailyLimit < 1 || googleDailyLimit > 100_000) {
    problems.push('GOOGLE_DAILY_LIMIT deve ser um inteiro entre 1 e 100000');
  }

  if (problems.length > 0) {
    throw new Error(`Configuração inválida:\n - ${problems.join('\n - ')}`);
  }

  return { nodeEnv, port, databaseUrl, jwtSecret, codeSecret, tokenTtlSeconds, corsOrigins, emailTransport: 'console', osmContact: env.OSM_CONTACT?.trim() || undefined, googlePlacesKey: env.GOOGLE_PLACES_API_KEY?.trim() || undefined, googleDailyLimit };
}
