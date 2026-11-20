import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? true,
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

  const frontendDist = join(__dirname, '..', 'frontend', 'dist');
  if (existsSync(frontendDist)) {
    const fastify = app.getHttpAdapter().getInstance();
    fastify.register(fastifyStatic, {
      root: frontendDist,
      index: false,
      maxAge: 0,
      wildcard: false,
    });
    fastify.route({
      method: ['GET', 'HEAD'],
      url: '/*',
      handler: (request, reply) => {
        const pathname = (request.raw.url ?? '/').split('?')[0];
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          return reply.code(404).send({ statusCode: 404, message: 'Not Found' });
        }

        const candidate = resolve(frontendDist, `.${pathname}`);
        const filePath = relative(frontendDist, candidate);
        const insideFrontend =
          filePath === '' ||
          (filePath !== '..' &&
            !filePath.startsWith(`..${sep}`) &&
            !isAbsolute(filePath));
        if (
          insideFrontend &&
          existsSync(candidate) &&
          statSync(candidate).isFile()
        ) {
          return reply.sendFile(filePath);
        }
        return reply.type('text/html').sendFile('index.html');
      },
    });
  }

  const port = Number(process.env.PORT ?? 4100);
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
