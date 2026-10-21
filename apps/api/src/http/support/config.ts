import { vapidKeysMatch } from '../../infra/push/web-push-sender.ts';
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
  /** ID do aplicativo Google (client ID web) para "Entrar com Google". Sem ele, o botão não aparece. */
  googleClientId: string | undefined;
  /** ID de serviço da Apple (Services ID) para "Entrar com a Apple". Sem ele, o botão não aparece. */
  appleClientId: string | undefined;
  /** Chaves VAPID do Web Push. Sem as duas, o aviso fora do app fica desligado (o sino dentro do app continua). */
  vapid: { publicKey: string; privateKey: string; subject: string } | undefined;
  /** Provedor de pagamento do impulsionamento. “sandbox” é só de teste (não cobra); “stripe” cobra de verdade; sem valor, recusa criar pedidos. */
  paymentProvider: 'sandbox' | 'stripe' | undefined;
  /** Dados da Stripe, só quando `paymentProvider` é “stripe”. */
  stripe: { secretKey: string; webhookSecret: string; webBaseUrl: string } | undefined;
  /**
   * Chave geral do impulsionamento pago. Desligada por padrão: sem `PAYMENTS_ENABLED=true` nenhum pedido novo é aceito
   * (anúncios já pagos continuam valendo). Ligar só depois do lançamento nas lojas.
   */
  paymentsEnabled: boolean;
  /** Valor do impulsionamento por dia, em centavos de real. */
  boostPricePerDayCents: number;
  /** Valor por dia na compra dentro do app (iOS/Android), em centavos. Padrão: o mesmo da web. */
  boostStorePricePerDayCents: number;
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

  const vapidPublic = env.VAPID_PUBLIC_KEY?.trim() ?? '';
  const vapidPrivate = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const vapidSubject = env.VAPID_SUBJECT?.trim() || 'mailto:contato@askout.invalid';
  let vapid: AppConfig['vapid'];
  if (vapidPublic !== '' || vapidPrivate !== '') {
    if (vapidPublic === '' || vapidPrivate === '') problems.push('VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY devem ser definidas juntas');
    else if (!vapidKeysMatch({ publicKey: vapidPublic, privateKey: vapidPrivate })) problems.push('VAPID_PUBLIC_KEY não corresponde à VAPID_PRIVATE_KEY (rode "npm run update" ou gere de novo o par)');
    else if (!/^(mailto:|https:\/\/)/.test(vapidSubject)) problems.push('VAPID_SUBJECT deve começar com mailto: ou https://');
    else vapid = { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject };
  }

  const enabledRaw = env.PAYMENTS_ENABLED?.trim().toLowerCase() ?? '';
  let paymentsEnabled = false;
  if (enabledRaw === 'true' || enabledRaw === '1') paymentsEnabled = true;
  else if (enabledRaw !== '' && enabledRaw !== 'false' && enabledRaw !== '0') problems.push('PAYMENTS_ENABLED deve ser true ou false');

  const paymentRaw = env.PAYMENT_PROVIDER?.trim() ?? '';
  let paymentProvider: AppConfig['paymentProvider'];
  let stripe: AppConfig['stripe'];
  if (paymentRaw === 'sandbox') {
    if (nodeEnv === 'production') problems.push('PAYMENT_PROVIDER=sandbox é só de teste e é recusado em produção (não cobra de verdade)');
    else paymentProvider = 'sandbox';
  } else if (paymentRaw === 'stripe') {
    const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? '';
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
    const webBaseUrl = env.PUBLIC_WEB_URL?.trim() ?? '';
    const before = problems.length;
    if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) problems.push('STRIPE_SECRET_KEY deve ser a chave secreta da Stripe (sk_test_… ou sk_live_…)');
    else if (nodeEnv === 'production' && !secretKey.includes('_live_')) problems.push('Em produção a Stripe exige a chave real (sk_live_…); chave de teste é recusada');
    if (!/^whsec_[A-Za-z0-9]+$/.test(webhookSecret)) problems.push('STRIPE_WEBHOOK_SECRET deve ser o segredo do webhook da Stripe (whsec_…)');
    if (!/^https?:\/\/[^\s/]+$/.test(webBaseUrl)) problems.push('PUBLIC_WEB_URL deve ser o endereço do site, sem barra no fim (ex.: https://askout.com.br)');
    else if (nodeEnv === 'production' && !webBaseUrl.startsWith('https://')) problems.push('Em produção PUBLIC_WEB_URL precisa ser https');
    if (problems.length === before) {
      paymentProvider = 'stripe';
      stripe = { secretKey, webhookSecret, webBaseUrl };
    }
  } else if (paymentRaw !== '') {
    problems.push('PAYMENT_PROVIDER deve ser "sandbox" ou "stripe"');
  } else if (nodeEnv !== 'production') {
    // Em desenvolvimento o teste sem dinheiro já vem ligado, para o fluxo funcionar sem configurar nada.
    paymentProvider = 'sandbox';
  }

  const boostPricePerDayCents = Number(env.BOOST_PRICE_PER_DAY_CENTS ?? '1500');
  if (!Number.isInteger(boostPricePerDayCents) || boostPricePerDayCents < 100 || boostPricePerDayCents > 1_000_000) {
    problems.push('BOOST_PRICE_PER_DAY_CENTS deve ser um inteiro de 100 a 1000000 (centavos)');
  }

  if (paymentsEnabled && paymentProvider === undefined) {
    problems.push('PAYMENTS_ENABLED=true exige um provedor de pagamento: defina PAYMENT_PROVIDER (e, para a Stripe, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET e PUBLIC_WEB_URL)');
  }

  const storePriceRaw = env.BOOST_STORE_PRICE_PER_DAY_CENTS?.trim() ?? '';
  const boostStorePricePerDayCents = storePriceRaw === '' ? boostPricePerDayCents : Number(storePriceRaw);
  if (!Number.isInteger(boostStorePricePerDayCents) || boostStorePricePerDayCents < 100 || boostStorePricePerDayCents > 1_000_000) {
    problems.push('BOOST_STORE_PRICE_PER_DAY_CENTS deve ser um inteiro de 100 a 1000000 (centavos)');
  }

  if (problems.length > 0) {
    throw new Error(`Configuração inválida:\n - ${problems.join('\n - ')}`);
  }

  return { nodeEnv, port, databaseUrl, jwtSecret, codeSecret, tokenTtlSeconds, corsOrigins, emailTransport: 'console', osmContact: env.OSM_CONTACT?.trim() || undefined, googlePlacesKey: env.GOOGLE_PLACES_API_KEY?.trim() || undefined, googleDailyLimit, googleClientId: env.GOOGLE_CLIENT_ID?.trim() || undefined, appleClientId: env.APPLE_CLIENT_ID?.trim() || undefined, vapid, paymentProvider, stripe, paymentsEnabled, boostPricePerDayCents, boostStorePricePerDayCents };
}
