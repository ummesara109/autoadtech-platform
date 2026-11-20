import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { RequestListener } from 'node:http';
import { AppModule } from '../dist/app.module.js';

let applicationPromise: Promise<NestExpressApplication> | undefined;

async function createApplication(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
  );

  app.enableCors({
    origin:
      process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ??
      true,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}

function getApplication(): Promise<NestExpressApplication> {
  if (!applicationPromise) {
    applicationPromise = createApplication().catch((error: unknown) => {
      applicationPromise = undefined;
      throw error;
    });
  }
  return applicationPromise;
}

export default async function handler(
  request: Request,
  response: Response,
): Promise<void> {
  const app = await getApplication();
  const listener = app
    .getHttpAdapter()
    .getInstance() as unknown as RequestListener;
  listener(request, response);
}
