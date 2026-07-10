import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.statusCode)
        .send({ error: err.code, message: err.message, details: err.details });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(422).send({
        error: 'validation',
        message: 'Ошибка валидации данных',
        details: err.validation,
      });
    }
    if (err instanceof ZodError) {
      return reply
        .status(422)
        .send({ error: 'validation', message: 'Ошибка валидации данных', details: err.flatten() });
    }
    const asErr = err as { statusCode?: number; message?: string };
    if (asErr.statusCode && asErr.statusCode < 500) {
      return reply.status(asErr.statusCode).send({ error: 'error', message: asErr.message ?? 'Ошибка' });
    }
    request.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Внутренняя ошибка сервера' });
  });
}
