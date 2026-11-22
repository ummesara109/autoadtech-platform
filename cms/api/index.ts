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

  const corsOrigins = process.env.CORS_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins?.length
      ? corsOrigins
      : process.env.NODE_ENV === 'production'
        ? false
        : true,
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

function restoreApiPath(request: Request, response: Response): boolean {
  const rewrittenUrl = new URL(request.url ?? '/', 'http://localhost');
  const apiPath = rewrittenUrl.searchParams
    .getAll('__cms_path')
    .find((path) => path === '/api' || path.startsWith('/api/'));

  if (!apiPath) {
    response.status(404).json({ statusCode: 404, message: 'Not Found' });
    return false;
  }

  rewrittenUrl.searchParams.delete('__cms_path');
  request.url = `${apiPath}${rewrittenUrl.search}`;
  return true;
}

export default async function handler(
  request: Request,
  response: Response,
): Promise<void> {
  if (!restoreApiPath(request, response)) return;

  const app = await getApplication();
  const listener = app
    .getHttpAdapter()
    .getInstance() as unknown as RequestListener;
  listener(request, response);
}
