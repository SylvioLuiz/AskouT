import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { AllExceptionsFilter } from './exception.filter.ts';
import type { AppConfig } from './support/config.ts';
import { CONFIG } from './tokens.ts';

const app = await NestFactory.create(AppModule);
const config = app.get<AppConfig>(CONFIG);

app.useGlobalFilters(new AllExceptionsFilter());
app.enableShutdownHooks();
if (config.corsOrigins.length > 0) {
  app.enableCors({ origin: config.corsOrigins, credentials: false });
}

await app.listen(config.port);
console.log(`AskouT API ouvindo na porta ${config.port} (${config.nodeEnv})`);
