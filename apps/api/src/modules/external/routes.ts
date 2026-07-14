import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  externalCancelInput,
  externalCancelResult,
  externalCreateTenderInput,
  externalResults,
  externalTenderCreated,
  externalTenderState,
} from '@zakupki/shared';
import { externalRateLimit } from '../../plugins/apiKey';
import {
  cancelExternalTender,
  createExternalTender,
  getExternalResults,
  getExternalTenderState,
} from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function externalRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Liveness для ping клиента — намеренно без ключа.
  r.get('/health', { config: externalRateLimit }, async () => ({ status: 'ok' }));

  r.post(
    '/tenders',
    {
      preHandler: app.requireApiKey('tenders:create'),
      config: externalRateLimit,
      // Тело разбирается в хендлере, а не схемой маршрута: иначе request.body
      // подменится результатом zod и хэш идемпотентности посчитается не по
      // сырому телу, а 400-кейсы контракта превратятся в 422.
      schema: { response: { 200: externalTenderCreated, 201: externalTenderCreated } },
    },
    async (request, reply) => {
      const rawBody = request.body;
      const input = externalCreateTenderInput.parse(rawBody);
      const { status, body } = await createExternalTender(app.db, rawBody, input, {
        viewer: request.apiViewer!,
        apiKeyId: request.apiKey!.id,
      });
      return reply.status(status).send(body);
    },
  );

  r.get(
    '/tenders/:id',
    {
      preHandler: app.requireApiKey('tenders:read'),
      config: externalRateLimit,
      schema: { params: idParam, response: { 200: externalTenderState } },
    },
    async (request) => getExternalTenderState(app.db, request.params.id, request.apiViewer!),
  );

  r.get(
    '/tenders/:id/results',
    {
      preHandler: app.requireApiKey('tenders:read'),
      config: externalRateLimit,
      schema: { params: idParam, response: { 200: externalResults } },
    },
    async (request) => getExternalResults(app.db, request.params.id, request.apiViewer!),
  );

  r.post(
    '/tenders/:id/cancel',
    {
      preHandler: app.requireApiKey('tenders:cancel'),
      config: externalRateLimit,
      schema: { params: idParam, response: { 200: externalCancelResult } },
    },
    async (request) => {
      const body = externalCancelInput.parse(request.body ?? undefined);
      return cancelExternalTender(app.db, request.params.id, request.apiViewer!, body?.reason);
    },
  );
}
