import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { verdictInput } from '@zakupki/shared';
import { getOrgById } from '../organizations/service';
import { getQueue, getReviewHistory, issueVerdict, orgDocuments } from './service';

export async function accreditationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/queue',
    {
      preHandler: app.requireRole('security', 'admin'),
      schema: { querystring: z.object({ status: z.string().optional() }) },
    },
    async (request) => getQueue(app.db, request.query.status),
  );

  r.get(
    '/:orgId',
    {
      preHandler: app.requireRole('security', 'admin'),
      schema: { params: z.object({ orgId: z.string().uuid() }) },
    },
    async (request) => {
      const org = await getOrgById(app.db, request.params.orgId);
      const [documents, reviews] = await Promise.all([
        orgDocuments(app.db, request.params.orgId),
        getReviewHistory(app.db, request.params.orgId),
      ]);
      return { org, documents, reviews };
    },
  );

  r.post(
    '/:orgId/verdict',
    {
      preHandler: app.requireRole('security', 'admin'),
      schema: { params: z.object({ orgId: z.string().uuid() }), body: verdictInput },
    },
    async (request) => {
      await issueVerdict(app.db, request.user.sub, request.params.orgId, request.body);
      return { ok: true };
    },
  );
}
