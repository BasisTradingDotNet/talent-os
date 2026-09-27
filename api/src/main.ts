import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';
import { cfg } from './common/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const { port } = cfg();
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`talent-os API listening on :${port}`);
}

void bootstrap();
