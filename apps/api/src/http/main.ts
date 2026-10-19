import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.ts';
import { AllExceptionsFilter } from './exception.filter.ts';
import type { AppConfig } from './support/config.ts';
import { CONFIG } from './tokens.ts';

// Carrega o .env da pasta atual (o Node não faz isso sozinho). Variáveis já definidas no ambiente
// têm prioridade, então em produção valem as do servidor.
if (existsSync('.env')) process.loadEnvFile('.env');

const app = await NestFactory.create<NestExpressApplication>(AppModule);
const config = app.get<AppConfig>(CONFIG);

// Posts levam até 5 fotos já reduzidas (≤100 KB cada, em base64) e o pedido de reivindicação leva um documento de até 2 MB (~2,7 MB em base64):
// o limite padrão (100 KB) não basta.
app.useBodyParser('json', { limit: '3mb' });
// Fotos e vídeos da conversa chegam como arquivo cru (sem base64): até 20 MB, só desses tipos.
app.useBodyParser('raw', { type: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'], limit: '61mb' });
app.useGlobalFilters(new AllExceptionsFilter());
app.enableShutdownHooks();
if (config.corsOrigins.length > 0) {
  app.enableCors({ origin: config.corsOrigins, credentials: false });
}

await app.listen(config.port);
console.log(`AskouT API ouvindo na porta ${config.port} (${config.nodeEnv})`);
