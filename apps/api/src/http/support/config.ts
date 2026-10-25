import { apnsKeyIsValid } from '../../infra/push/apns-sender.ts';
import { parseServiceAccount } from '../../infra/google/service-account.ts';
import type { ServiceAccountCredentials } from '../../infra/google/service-account.ts';
import { vapidKeysMatch } from '../../infra/push/web-push-sender.ts';
export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  codeSecret: string;
  tokenTtlSeconds: number;
  corsOrigins: string[];
  /** Limite de requisições ligado. Só dá para desligar (RATE_LIMIT=off) fora de produção. */
  rateLimitEnabled: boolean;
  /** Quantos proxies confiáveis ficam na frente da API (Railway = 1). Define de onde vem o IP do cliente. */
  trustProxyHops: number;
  /** “console” imprime o código no terminal (só desenvolvimento); “resend” envia e-mail de verdade. */
  emailTransport: 'console' | 'resend';
  /** Dados do Resend, só quando `emailTransport` é “resend”. */
  resend: { apiKey: string; from: string; replyTo: string | undefined } | undefined;
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
  /** Bundle id do app nativo na Apple (aceito como público do token de "Entrar com a Apple"). */
  appleAppId: string | undefined;
  /** Chaves VAPID do Web Push. Sem as duas, o aviso fora do app fica desligado (o sino dentro do app continua). */
  vapid: { publicKey: string; privateKey: string; subject: string } | undefined;
  /** Chave da Apple (APNs) para avisos no app do iPhone. Sem as três variáveis, o push do app fica desligado. */
  apns: { keyId: string; teamId: string; privateKey: string; bundleId: string; production: boolean } | undefined;
  /** Conta de serviço do Google (aviso no Android pelo FCM e conferência de compra no Google Play). */
  googleServiceAccount: ServiceAccountCredentials | undefined;
  /** Nome do pacote do app no Google Play. */
  googlePlayPackage: string;
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
  boostPricePerDayCents?: number;
  /** Valor por dia na compra dentro do app (iOS/Android), em centavos. Padrão: o mesmo da web. */
  boostStorePricePerDayCents?: number;
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

  const emailRaw = env.EMAIL_TRANSPORT ?? 'console';
  const emailTransport: AppConfig['emailTransport'] = emailRaw === 'resend' ? 'resend' : 'console';
  let resend: AppConfig['resend'];
  if (emailRaw === 'resend') {
    const apiKey = env.RESEND_API_KEY?.trim() ?? '';
    const from = env.EMAIL_FROM?.trim() ?? '';
    const replyTo = env.EMAIL_REPLY_TO?.trim() || undefined;
    const before = problems.length;
    if (!/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey)) problems.push('RESEND_API_KEY deve ser a chave da API do Resend (re_…)');
    if (!/^(?:[^<>@\r\n]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/.test(from)) problems.push('EMAIL_FROM deve ser um e-mail do seu domínio, como "AskouT <nao-responda@seudominio.com.br>"');
    if (replyTo !== undefined && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(replyTo)) problems.push('EMAIL_REPLY_TO deve ser um e-mail');
    if (problems.length === before) resend = { apiKey, from, replyTo };
  } else if (emailRaw !== 'console') {
    problems.push('EMAIL_TRANSPORT deve ser "console" ou "resend"');
  } else if (nodeEnv === 'production') {
    problems.push('Em produção o envio "console" é recusado: ele imprime os códigos de cadastro no log. Use EMAIL_TRANSPORT=resend');
  }

  const rateLimitEnabled = !(env.RATE_LIMIT === 'off' && nodeEnv !== 'production');
  if (env.RATE_LIMIT === 'off' && nodeEnv === 'production') problems.push('RATE_LIMIT=off não é aceito em produção');
  const trustProxyHops = env.TRUST_PROXY_HOPS === undefined || env.TRUST_PROXY_HOPS.trim() === '' ? (nodeEnv === 'production' ? 1 : 0) : Number(env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) problems.push('TRUST_PROXY_HOPS deve ser um inteiro entre 0 e 5');
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

  const apnsKeyId = env.APNS_KEY_ID?.trim() ?? '';
  const apnsTeamId = env.APNS_TEAM_ID?.trim() ?? '';
  const apnsPrivateKey = env.APNS_PRIVATE_KEY?.trim() ?? '';
  const apnsBundleId = env.APNS_BUNDLE_ID?.trim() || env.APPLE_APP_ID?.trim() || 'br.com.askout';
  const apnsEnvironment = (env.APNS_ENVIRONMENT?.trim().toLowerCase() || 'production');
  let apns: AppConfig['apns'];
  if (apnsKeyId !== '' || apnsTeamId !== '' || apnsPrivateKey !== '') {
    if (apnsKeyId === '' || apnsTeamId === '' || apnsPrivateKey === '') problems.push('APNS_KEY_ID, APNS_TEAM_ID e APNS_PRIVATE_KEY devem ser definidas juntas');
    else if (!/^[A-Z0-9]{10}$/.test(apnsKeyId)) problems.push('APNS_KEY_ID deve ter 10 letras/números (mostrado ao criar a chave na Apple)');
    else if (!/^[A-Z0-9]{10}$/.test(apnsTeamId)) problems.push('APNS_TEAM_ID deve ter 10 letras/números (Team ID da conta Apple)');
    else if (!apnsKeyIsValid(apnsPrivateKey)) problems.push('APNS_PRIVATE_KEY não é uma chave .p8 válida (cole o conteúdo inteiro do arquivo, com BEGIN/END PRIVATE KEY)');
    else if (apnsEnvironment !== 'production' && apnsEnvironment !== 'sandbox') problems.push('APNS_ENVIRONMENT deve ser production ou sandbox');
    else apns = { keyId: apnsKeyId, teamId: apnsTeamId, privateKey: apnsPrivateKey, bundleId: apnsBundleId, production: apnsEnvironment === 'production' };
  }

  const googleSaRaw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? '';
  let googleServiceAccount: ServiceAccountCredentials | undefined;
  if (googleSaRaw !== '') {
    googleServiceAccount = parseServiceAccount(googleSaRaw);
    if (!googleServiceAccount) problems.push('GOOGLE_SERVICE_ACCOUNT_JSON não é o arquivo JSON de uma conta de serviço do Google (cole o conteúdo inteiro do arquivo baixado)');
  }
  const googlePlayPackage = env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || 'br.com.askout';

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

  // Sem esta variável valem os pacotes com desconto progressivo (ver BOOST_DEFAULT_PACKAGE_PRICES_CENTS).
  const priceRaw = env.BOOST_PRICE_PER_DAY_CENTS?.trim() ?? '';
  const boostPricePerDayCents = priceRaw === '' ? undefined : Number(priceRaw);
  if (boostPricePerDayCents !== undefined && (!Number.isInteger(boostPricePerDayCents) || boostPricePerDayCents < 100 || boostPricePerDayCents > 1_000_000)) {
    problems.push('BOOST_PRICE_PER_DAY_CENTS deve ser um inteiro de 100 a 1000000 (centavos)');
  }

  if (paymentsEnabled && paymentProvider === undefined) {
    problems.push('PAYMENTS_ENABLED=true exige um provedor de pagamento: defina PAYMENT_PROVIDER (e, para a Stripe, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET e PUBLIC_WEB_URL)');
  }

  const storePriceRaw = env.BOOST_STORE_PRICE_PER_DAY_CENTS?.trim() ?? '';
  const boostStorePricePerDayCents = storePriceRaw === '' ? undefined : Number(storePriceRaw);
  if (boostStorePricePerDayCents !== undefined && (!Number.isInteger(boostStorePricePerDayCents) || boostStorePricePerDayCents < 100 || boostStorePricePerDayCents > 1_000_000)) {
    problems.push('BOOST_STORE_PRICE_PER_DAY_CENTS deve ser um inteiro de 100 a 1000000 (centavos)');
  }

  if (problems.length > 0) {
    throw new Error(`Configuração inválida:\n - ${problems.join('\n - ')}`);
  }

  return { nodeEnv, port, databaseUrl, jwtSecret, codeSecret, tokenTtlSeconds, corsOrigins, rateLimitEnabled, trustProxyHops, emailTransport, resend, osmContact: env.OSM_CONTACT?.trim() || undefined, googlePlacesKey: env.GOOGLE_PLACES_API_KEY?.trim() || undefined, googleDailyLimit, googleClientId: env.GOOGLE_CLIENT_ID?.trim() || undefined, appleClientId: env.APPLE_CLIENT_ID?.trim() || undefined, appleAppId: env.APPLE_APP_ID?.trim() || undefined, vapid, apns, googleServiceAccount, googlePlayPackage, paymentProvider, stripe, paymentsEnabled, ...(boostPricePerDayCents === undefined ? {} : { boostPricePerDayCents }), ...(boostStorePricePerDayCents === undefined ? {} : { boostStorePricePerDayCents }) };
}
