import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { env } from './config/env';
import { registerAuth } from './plugins/auth';
import { registerCsrf } from './plugins/csrf';
import { registerDb } from './plugins/db';
import { registerErrorHandler } from './plugins/errorHandler';
import { routes } from './routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Behind nginx (prod): honor X-Forwarded-* for correct client IP & rate-limiting.
    trustProxy: env.TRUST_PROXY,
    logger:
      env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : env.NODE_ENV === 'test'
          ? false
          : true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
  await app.register(rateLimit, { max: 400, timeWindow: '1 minute' });

  registerDb(app);
  await registerAuth(app);
  registerCsrf(app);

  await app.register(routes, { prefix: '/api/v1' });

  return app;
}
