import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const startTime = Date.now();
  console.log('[Bootstrap] Starting application initialization...');

  const appStartTime = Date.now();
  const app = await NestFactory.create(AppModule);
  const appDurationMs = Date.now() - appStartTime;
  console.log(`[Bootstrap] NestFactory.create completed in ${appDurationMs}ms`);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  const totalDurationMs = Date.now() - startTime;
  console.log(`[Bootstrap] API listening on http://localhost:${port}/api/graphql (total startup: ${totalDurationMs}ms)`);
}

void bootstrap();
