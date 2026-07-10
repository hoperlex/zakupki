import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createCategoryInput, TENDER_TYPES } from '@zakupki/shared';
import { createCategory, listCategoryTree } from './service';

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/',
    { schema: { querystring: z.object({ kind: z.enum(TENDER_TYPES).optional() }) } },
    async (request) => listCategoryTree(app.db, request.query.kind),
  );

  r.post(
    '/',
    { preHandler: app.requireRole('admin'), schema: { body: createCategoryInput } },
    async (request, reply) => {
      const id = await createCategory(app.db, request.body);
      return reply.status(201).send({ id });
    },
  );
}
